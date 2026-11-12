import { HttpError } from "../http";
import {
  digest,
  parseCommand,
  validateCandidate,
  validateDecision,
  type Candidate,
  type Command,
} from "./contract";
export type Row = Record<string, unknown>;
export type Sql = {
  query(sql: string, params?: unknown[]): Promise<{ rows: Row[] }>;
};
export type Database = Sql & {
  transaction<T>(fn: (sql: Sql) => Promise<T>): Promise<T>;
};
export type SavedRevision = {
  id: string;
  candidateId: string;
  parentRevision: string | null;
  actorId: string;
  requestId: string;
  requestHash: string;
  serverStamp: string;
  command: Command;
};
function revision(row: Row): SavedRevision {
  const v = {
    candidateId: String(row.candidate_id),
    parentRevision: row.parent_id === null ? null : String(row.parent_id),
    actorId: String(row.actor_id),
    requestId: String(row.request_id),
    requestHash: String(row.request_hash),
    serverStamp: String(row.server_stamp),
    command: parseCommand(row.payload),
  };
  if (digest(v) !== row.id) throw new Error("Review history integrity failed.");
  return { id: String(row.id), ...v };
}
function candidate(row: Row) {
  const data = validateCandidate(row.payload as Candidate);
  if (data.id !== row.id || digest(data) !== row.payload_hash)
    throw new Error("Candidate integrity failed.");
  return data;
}
export class ExtractionStore {
  constructor(
    readonly db: Database,
    readonly environmentId: string,
    readonly verifyEvidence: (value: Candidate) => Promise<void>,
  ) {}
  private async environment(sql: Sql) {
    const r = await sql.query(
      "SELECT environment_id FROM extraction_staging.environment WHERE singleton=true",
    );
    if (r.rows.length !== 1 || r.rows[0].environment_id !== this.environmentId)
      throw new Error("Wrong staging environment.");
  }
  private async reviewer(sql: Sql, userId: string) {
    if (!userId || userId.length > 200)
      throw new HttpError(401, "Sign in first.");
    await this.environment(sql);
    await this.grantLock(sql, userId);
    const r = await sql.query(
      "SELECT user_id FROM extraction_staging.capabilities WHERE user_id=$1 AND capability='EXTRACTION_REVIEW' AND revoked_at IS NULL AND expires_at>now()",
      [userId],
    );
    if (r.rows.length !== 1)
      throw new HttpError(
        403,
        "Extraction reviewer access has not been granted.",
      );
  }
  private async grantLock(sql: Sql, userId: string) {
    await sql.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
      "extraction-grant:" + this.environmentId + ":" + userId,
    ]);
  }
  private async bound(sql: Sql, id: string, lock = false) {
    if (lock) await this.candidateLock(sql, id);
    const r = await sql.query(
      "SELECT * FROM extraction_staging.candidates WHERE id=$1",
      [id],
    );
    if (!r.rows[0]) throw new HttpError(404, "Extraction draft not found.");
    return candidate(r.rows[0]);
  }
  private async candidateLock(sql: Sql, id: string) {
    await sql.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
      "extraction-candidate:" + id,
    ]);
  }
  private async history(sql: Sql, id: string) {
    const h = await sql.query(
      "SELECT revision_id FROM extraction_staging.heads WHERE candidate_id=$1",
      [id],
    );
    const rows = await sql.query(
      "SELECT * FROM extraction_staging.revisions WHERE candidate_id=$1 ORDER BY created_at DESC,id LIMIT 101",
      [id],
    );
    if (rows.rows.length > 100)
      throw new Error("Review history exceeds budget.");
    const records = rows.rows.map(revision),
      byId = new Map(records.map((r) => [r.id, r])),
      ordered: SavedRevision[] = [];
    const head = h.rows[0] ? String(h.rows[0].revision_id) : null;
    let next = head;
    while (next) {
      const item = byId.get(next);
      if (!item || ordered.some((r) => r.id === item.id))
        throw new Error("Invalid review chain.");
      ordered.push(item);
      next = item.parentRevision;
    }
    if (ordered.length !== records.length)
      throw new Error("Orphaned or rolled-back review history.");
    return { headRevision: head, revisions: ordered };
  }
  async list(userId: string) {
    return this.db.transaction(async (sql) => {
      await this.reviewer(sql, userId);
      const r = await sql.query(
        "SELECT * FROM extraction_staging.candidates ORDER BY created_at,id LIMIT 30",
      );
      return r.rows.map((row) => {
        const c = candidate(row);
        return {
          id: c.id,
          title: c.title,
          state: c.state,
          scopeNote: c.scopeNote,
        };
      });
    });
  }
  async get(userId: string, id: string) {
    return this.db.transaction(async (sql) => {
      await this.reviewer(sql, userId);
      const c = await this.bound(sql, id, true);
      await this.verifyEvidence(c);
      return {
        candidate: c,
        history: await this.history(sql, id),
        publicationEligible: false,
        taxApproved: false,
        retrievalItemsCreated: 0,
      };
    });
  }
  async save(userId: string, input: unknown) {
    const command = parseCommand(input);
    return this.db.transaction(async (sql) => {
      await this.reviewer(sql, userId);
      const c = await this.bound(sql, command.candidateId, true);
      await this.verifyEvidence(c);
      const history = await this.history(sql, c.id),
        requestHash = digest({ actorId: userId, command });
      const previous = await sql.query(
        "SELECT * FROM extraction_staging.revisions WHERE actor_id=$1 AND request_id=$2",
        [userId, command.requestId],
      );
      if (previous.rows[0]) {
        const old = revision(previous.rows[0]);
        if (old.requestHash !== requestHash)
          throw new HttpError(
            409,
            "Retry identity was reused for another edit.",
          );
        return {
          revision: old,
          headRevision: history.headRevision,
          publicationEligible: false,
          taxApproved: false,
          retrievalItemsCreated: 0,
        };
      }
      if (command.parentRevision !== history.headRevision)
        throw new HttpError(
          409,
          "A newer review exists. Load it before saving.",
        );
      if (history.revisions.length >= 100)
        throw new HttpError(
          409,
          "Review revision limit reached. Export your notes and contact the operator.",
        );
      validateDecision(c, command);
      const at = await sql.query("SELECT now()::text AS stamp");
      const body = {
        candidateId: c.id,
        parentRevision: history.headRevision,
        actorId: userId,
        requestId: command.requestId,
        requestHash,
        serverStamp: String(at.rows[0].stamp),
        command,
      };
      const saved = { id: digest(body), ...body };
      await sql.query(
        "INSERT INTO extraction_staging.revisions(id,candidate_id,parent_id,actor_id,request_id,request_hash,action,server_stamp,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)",
        [
          saved.id,
          c.id,
          saved.parentRevision,
          userId,
          command.requestId,
          requestHash,
          command.action,
          saved.serverStamp,
          JSON.stringify(command),
        ],
      );
      await sql.query(
        "INSERT INTO extraction_staging.heads(candidate_id,revision_id) VALUES($1,$2) ON CONFLICT(candidate_id) DO UPDATE SET revision_id=excluded.revision_id",
        [c.id, saved.id],
      );
      return {
        revision: saved,
        headRevision: saved.id,
        publicationEligible: false,
        taxApproved: false,
        retrievalItemsCreated: 0,
      };
    });
  }
  // Operator methods are never exposed by an HTTP handler.
  async register(value: Candidate) {
    const c = validateCandidate(value);
    await this.verifyEvidence(c);
    return this.db.transaction(async (sql) => {
      await this.environment(sql);
      await this.candidateLock(sql, c.id);
      const existing = await sql.query(
        "SELECT * FROM extraction_staging.candidates WHERE id=$1",
        [c.id],
      );
      if (existing.rows[0]) {
        if (digest(candidate(existing.rows[0])) !== digest(c))
          throw new HttpError(409, "Existing import has different evidence.");
        return c.id;
      }
      await sql.query(
        "INSERT INTO extraction_staging.candidates(id,payload,payload_hash) VALUES($1,$2::jsonb,$3)",
        [c.id, JSON.stringify(c), digest(c)],
      );
      return c.id;
    });
  }
  async capability(
    userId: string,
    action: "GRANT" | "REVOKE",
    reason: string,
    expiresAt?: string,
  ) {
    if (
      !identifierUser(userId) ||
      !reason.trim() ||
      reason.length > 4000 ||
      (action === "GRANT" &&
        (!expiresAt ||
          !Number.isFinite(Date.parse(expiresAt)) ||
          Date.parse(expiresAt) <= Date.now() ||
          Date.parse(expiresAt) > Date.now() + 90 * 86400000))
    )
      throw new Error(
        "Use an explicit user, reason and expiry within 90 days.",
      );
    return this.db.transaction(async (sql) => {
      await this.environment(sql);
      await this.grantLock(sql, userId);
      if (action === "GRANT")
        await sql.query(
          "INSERT INTO extraction_staging.capabilities(user_id,capability,reason,expires_at) VALUES($1,'EXTRACTION_REVIEW',$2,$3) ON CONFLICT(user_id) DO UPDATE SET reason=excluded.reason,expires_at=excluded.expires_at,revoked_at=NULL",
          [userId, reason, expiresAt],
        );
      else
        await sql.query(
          "UPDATE extraction_staging.capabilities SET revoked_at=now() WHERE user_id=$1",
          [userId],
        );
      await sql.query(
        "INSERT INTO extraction_staging.capability_events(user_id,action,reason) VALUES($1,$2,$3)",
        [userId, action, reason],
      );
    });
  }
}
function identifierUser(value: string) {
  return /^[A-Za-z0-9_-]{1,200}$/.test(value);
}
