import { HttpError } from "../http";
import { randomUUID } from "node:crypto";
import { repairReview, summarizeReview } from "./review-queue";
import { repairTargets, type RepairStatus } from "./ocr-repair-scope";
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
export type Reviewer = { id: string; email?: string | null };
type Principal = string | Reviewer;
export function reviewerEmail(actor: Principal) {
  return typeof actor === "string"
    ? null
    : actor.email?.trim().toLowerCase() || null;
}
function actorId(actor: Principal) {
  return typeof actor === "string" ? actor : actor.id;
}
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
export type RepairJob = {
  requestId: string;
  candidateId: string;
  lease: string;
  attempts: number;
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
function reviewHistory(head: string | null, rows: Row[]) {
  if (rows.length > 100) throw new Error("Review history exceeds budget.");
  const records = rows.map(revision),
    byId = new Map(records.map((r) => [r.id, r])),
    ordered: SavedRevision[] = [];
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
function inboxDecision(head?: Command["action"], decision?: Command["action"]) {
  if (head === "SAVE_DRAFT")
    return decision === "REQUEST_CHANGES" ? decision : undefined;
  return head;
}
function latestDecision(revisions: SavedRevision[]) {
  return inboxDecision(
    revisions[0]?.command.action,
    revisions.find((entry) => entry.command.action !== "SAVE_DRAFT")?.command
      .action,
  );
}
export class ExtractionStore {
  constructor(
    readonly db: Database,
    readonly environmentId: string,
    readonly verifyEvidence: (value: Candidate) => Promise<void>,
    readonly autoRepair = false,
  ) {}
  private async environment(sql: Sql) {
    const r = await sql.query(
      "SELECT environment_id FROM extraction_staging.environment WHERE singleton=true",
    );
    if (r.rows.length !== 1 || r.rows[0].environment_id !== this.environmentId)
      throw new Error("Wrong staging environment.");
  }
  private async reviewer(sql: Sql, actor: Principal) {
    const userId = actorId(actor);
    if (!userId || userId.length > 200)
      throw new HttpError(401, "Sign in first.");
    await this.environment(sql);
    await this.grantLock(sql, userId);
    const r = await sql.query(
      "SELECT extraction_staging.can_review($1,$2) AS granted",
      [userId, reviewerEmail(actor)],
    );
    if (r.rows[0]?.granted !== true)
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
    return reviewHistory(
      h.rows[0] ? String(h.rows[0].revision_id) : null,
      rows.rows,
    );
  }
  private async readCandidate(
    actor: Principal,
    id: string,
    includeHistory: boolean,
  ) {
    const userId = actorId(actor);
    if (!userId || userId.length > 200)
      throw new HttpError(401, "Sign in first.");
    // One statement gives the grant, candidate, and review chain a consistent
    // snapshot without waiting for the locks used by review writes.
    const {
      rows: [row],
    } = await this.db.query(
      `WITH access AS (
         SELECT environment_id, extraction_staging.can_review($1,$5) AS granted
         FROM extraction_staging.environment WHERE singleton=true
       )
       SELECT access.*, c.id, c.payload, c.payload_hash,
         CASE WHEN $3::boolean THEN (
           SELECT id FROM extraction_staging.candidates next
           WHERE next.payload->'repair'->>'replacesCandidateId'=c.id LIMIT 1
         ) END AS replacement_id,
         CASE WHEN $3::boolean THEN (
           SELECT revision_id FROM extraction_staging.heads WHERE candidate_id=c.id
         ) END AS head_revision,
         CASE WHEN $3::boolean THEN (
           SELECT COALESCE(jsonb_agg(to_jsonb(r)), '[]'::jsonb) FROM (
             SELECT * FROM extraction_staging.revisions WHERE candidate_id=c.id
             ORDER BY created_at DESC,id LIMIT 101
           ) r
         ) END AS revisions
       FROM access LEFT JOIN extraction_staging.candidates c
         ON c.id=$2 AND access.granted AND access.environment_id=$4`,
      [userId, id, includeHistory, this.environmentId, reviewerEmail(actor)],
    );
    if (row?.environment_id !== this.environmentId)
      throw new Error("Wrong staging environment.");
    if (row.granted !== true)
      throw new HttpError(
        403,
        "Extraction reviewer access has not been granted.",
      );
    if (!row.id) throw new HttpError(404, "Extraction draft not found.");
    return row;
  }
  async list(actor: Principal) {
    return this.db.transaction(async (sql) => {
      await this.reviewer(sql, actor);
      const r = await sql.query(
        `SELECT c.*, h.action AS head_action, d.action AS decision_action
           ${this.autoRepair ? ", job.status AS repair_status" : ""}
         FROM extraction_staging.candidates c
         LEFT JOIN extraction_staging.heads head ON head.candidate_id=c.id
         LEFT JOIN extraction_staging.revisions h ON h.id=head.revision_id
         LEFT JOIN LATERAL (
           WITH RECURSIVE trail AS (
             SELECT id, parent_id, action, 1 AS depth FROM extraction_staging.revisions WHERE id=head.revision_id
             UNION ALL
             SELECT r.id, r.parent_id, r.action, t.depth + 1 FROM extraction_staging.revisions r
             JOIN trail t ON r.id=t.parent_id
             WHERE t.action='SAVE_DRAFT' AND t.depth < 100 AND r.candidate_id=c.id
           )
           SELECT id, action FROM trail WHERE action <> 'SAVE_DRAFT' LIMIT 1
         ) d ON h.action='SAVE_DRAFT'
         ${this.autoRepair ? "LEFT JOIN extraction_staging.ocr_repair_jobs job ON job.request_id=COALESCE(d.id,h.id)" : ""}
         WHERE NOT EXISTS (
           SELECT 1 FROM extraction_staging.candidates next
           WHERE next.payload->'repair'->>'replacesCandidateId'=c.id
         )
         ORDER BY c.created_at DESC,c.id LIMIT 30`,
      );
      return r.rows.map((row) =>
        summarizeReview(
          candidate(row),
          inboxDecision(
            (row.head_action ?? undefined) as Command["action"] | undefined,
            (row.decision_action ?? undefined) as Command["action"] | undefined,
          ),
          (row.repair_status as RepairStatus | undefined) ?? null,
        ),
      );
    });
  }
  async get(actor: Principal, id: string) {
    const row = await this.readCandidate(actor, id, true);
    const c = candidate(row);
    const history = reviewHistory(
      row.head_revision as string | null,
      row.revisions as Row[],
    );
    const replacementId = row.replacement_id as string | null;
    const repair = c.repair ? await this.repairDetails(c) : null;
    return {
      candidate: c,
      history,
      replacementId,
      repair,
      summary: summarizeReview(
        c,
        latestDecision(history.revisions),
        await this.repairStatus(this.db, history.revisions),
      ),
      publicationEligible: false,
      taxApproved: false,
      retrievalItemsCreated: 0,
    };
  }
  private async repairDetails(c: Candidate) {
    const link = c.repair!;
    const {
      rows: [row],
    } = await this.db.query(
      `SELECT c.*, to_jsonb(r) AS request FROM extraction_staging.candidates c
       JOIN extraction_staging.revisions r ON r.candidate_id=c.id
       WHERE c.id=$1 AND r.id=$2`,
      [link.replacesCandidateId, link.requestRevisionId],
    );
    if (!row) throw new Error("Repair evidence is missing.");
    return repairReview(
      c,
      candidate(row),
      revision(row.request as Row).command,
    );
  }
  async sourceObject(actor: Principal, id: string, objectId: string) {
    const c = candidate(await this.readCandidate(actor, id, false));
    if (c.original.object_id === objectId)
      return { ref: c.original, pdf: true };
    const render = c.renders.find((page) => page.object.object_id === objectId);
    if (!render)
      throw new HttpError(404, "Evidence not available for this draft.");
    return { ref: render.object, pdf: false };
  }
  async save(actor: Principal, input: unknown) {
    const userId = actorId(actor);
    const command = parseCommand(input);
    const attempt = (verified?: Candidate) =>
      this.db.transaction(async (sql) => {
        await this.reviewer(sql, actor);
        const c = await this.bound(sql, command.candidateId, true);
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
            summary: summarizeReview(
              c,
              latestDecision(history.revisions),
              await this.repairStatus(sql, history.revisions),
            ),
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
        if (await this.replacementId(sql, c.id))
          throw new HttpError(
            409,
            "A repaired version is ready. Open it in the inbox.",
          );
        if (history.revisions.length >= 100)
          throw new HttpError(
            409,
            "Review revision limit reached. Export your notes and contact the operator.",
          );
        validateDecision(c, command);
        if (command.action === "ACCEPT_EXTRACTION") {
          if (latestDecision(history.revisions) === "REQUEST_CHANGES")
            throw new HttpError(
              409,
              "This version has a pending correction request. Review the repaired extraction instead.",
            );
          if (!verified) return { verify: c };
          if (digest(verified) !== digest(c))
            throw new HttpError(
              409,
              "The source revision changed. Reopen the draft.",
            );
        }
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
        if (this.autoRepair && command.action === "REQUEST_CHANGES") {
          await sql.query(
            "INSERT INTO extraction_staging.ocr_repair_jobs(request_id,candidate_id,status) VALUES($1,$2,$3)",
            [
              saved.id,
              c.id,
              repairTargets(c, command).length ? "QUEUED" : "NEEDS_OPERATOR",
            ],
          );
        }
        const revisions = [saved, ...history.revisions];
        return {
          revision: saved,
          headRevision: saved.id,
          summary: summarizeReview(
            c,
            latestDecision(revisions),
            await this.repairStatus(sql, revisions),
          ),
          publicationEligible: false,
          taxApproved: false,
          retrievalItemsCreated: 0,
        };
      });
    const result = await attempt();
    if (!result.verify) return result;
    // Check storage without holding review locks or occupying a DB connection.
    // The final transaction checks the grant and expected parent again.
    await this.verifyEvidence(result.verify);
    const accepted = await attempt(result.verify);
    if (accepted.verify)
      throw new Error("Source verification was not applied.");
    return accepted;
  }
  private async repairStatus(sql: Sql, revisions: SavedRevision[]) {
    const request = revisions.find((r) => r.command.action !== "SAVE_DRAFT");
    if (!this.autoRepair || request?.command.action !== "REQUEST_CHANGES")
      return null;
    const {
      rows: [row],
    } = await sql.query(
      "SELECT status FROM extraction_staging.ocr_repair_jobs WHERE request_id=$1",
      [request.id],
    );
    return (row?.status as RepairStatus | undefined) ?? null;
  }
  private async replacementId(sql: Sql, id: string) {
    const {
      rows: [row],
    } = await sql.query(
      "SELECT id FROM extraction_staging.candidates WHERE payload->'repair'->>'replacesCandidateId'=$1 LIMIT 1",
      [id],
    );
    return row?.id;
  }
  async claimRepair(requestId?: string): Promise<RepairJob | null> {
    if (!this.autoRepair) throw new Error("OCR repair is disabled.");
    return this.db.transaction(async (sql) => {
      await this.environment(sql);
      await sql.query(
        "UPDATE extraction_staging.ocr_repair_jobs SET status='FAILED',failure_code='LEASE_EXPIRED',lease_id=NULL,lease_until=NULL WHERE status='PROCESSING' AND lease_until <= now() AND attempts=3",
      );
      const lease = randomUUID();
      const {
        rows: [row],
      } = await sql.query(
        `WITH next AS (
          SELECT request_id FROM extraction_staging.ocr_repair_jobs
          WHERE ($2::text IS NULL OR request_id=$2)
            AND ((status='QUEUED' AND available_at <= now())
              OR (status='PROCESSING' AND lease_until <= now() AND attempts < 3))
          ORDER BY available_at,request_id FOR UPDATE SKIP LOCKED LIMIT 1
        )
        UPDATE extraction_staging.ocr_repair_jobs job
        SET status='PROCESSING',attempts=attempts+1,lease_id=$1,lease_until=now()+interval '5 minutes',failure_code=NULL
        FROM next WHERE job.request_id=next.request_id
        RETURNING job.request_id,job.candidate_id,job.attempts`,
        [lease, requestId ?? null],
      );
      return row
        ? {
            requestId: String(row.request_id),
            candidateId: String(row.candidate_id),
            attempts: Number(row.attempts),
            lease,
          }
        : null;
    });
  }
  async repairPending(requestId: string) {
    const { rows } = await this.db.query(
      "SELECT 1 FROM extraction_staging.ocr_repair_jobs WHERE request_id=$1 AND status IN ('QUEUED','PROCESSING')",
      [requestId],
    );
    return rows.length > 0;
  }
  private async validLease(sql: Sql, job: RepairJob) {
    const { rows } = await sql.query(
      "SELECT 1 FROM extraction_staging.ocr_repair_jobs WHERE request_id=$1 AND candidate_id=$2 AND lease_id=$3 AND status='PROCESSING' AND lease_until>clock_timestamp() FOR UPDATE",
      [job.requestId, job.candidateId, job.lease],
    );
    return rows.length === 1;
  }
  async repairInput(job: RepairJob) {
    return this.db.transaction(async (sql) => {
      await this.environment(sql);
      const c = await this.bound(sql, job.candidateId, true);
      if (
        !(await this.validLease(sql, job)) ||
        (await this.replacementId(sql, c.id))
      )
        return null;
      const { revisions } = await this.history(sql, c.id);
      const request = revisions.find((r) => r.command.action !== "SAVE_DRAFT");
      if (
        request?.id !== job.requestId ||
        request.command.action !== "REQUEST_CHANGES"
      )
        return null;
      return { candidate: c, request: request.command };
    });
  }
  async endRepair(
    job: RepairJob,
    status: "QUEUED" | "NEEDS_OPERATOR" | "FAILED" | "SUPERSEDED",
    code: string,
  ) {
    await this.db.transaction(async (sql) => {
      await this.environment(sql);
      if (!(await this.validLease(sql, job))) return;
      await sql.query(
        `UPDATE extraction_staging.ocr_repair_jobs
         SET status=$2,failure_code=$3,lease_id=NULL,lease_until=NULL,
             available_at=now()+(attempts * interval '1 minute')
         WHERE request_id=$1`,
        [job.requestId, status, code],
      );
    });
  }
  async completeRepair(job: RepairJob, value: Candidate, model: string) {
    const c = validateCandidate(value);
    if (
      c.repair?.requestRevisionId !== job.requestId ||
      c.repair.replacesCandidateId !== job.candidateId
    )
      throw new Error("Repair does not belong to this job.");
    await this.verifyEvidence(c);
    return this.db.transaction(async (sql) => {
      await this.environment(sql);
      await this.candidateLock(sql, job.candidateId);
      if (!(await this.validLease(sql, job))) return false;
      await this.registerCandidate(sql, c);
      await sql.query(
        `UPDATE extraction_staging.ocr_repair_jobs
         SET status='READY',lease_id=NULL,lease_until=NULL,failure_code=NULL,result_id=$2,model=$3
         WHERE request_id=$1`,
        [job.requestId, c.id, model],
      );
      return true;
    });
  }
  // Candidate registration stays in operator and worker processes.
  async register(value: Candidate) {
    const c = validateCandidate(value);
    await this.verifyEvidence(c);
    return this.db.transaction(async (sql) => {
      await this.environment(sql);
      if (c.repair) await this.candidateLock(sql, c.repair.replacesCandidateId);
      return this.registerCandidate(sql, c);
    });
  }
  private async registerCandidate(sql: Sql, c: Candidate) {
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
    if (c.repair) {
      const previous = await this.bound(sql, c.repair.replacesCandidateId);
      const history = await this.history(sql, previous.id);
      const request = history.revisions.find(
        (entry) => entry.command.action !== "SAVE_DRAFT",
      );
      if (
        request?.id !== c.repair.requestRevisionId ||
        request.command.action !== "REQUEST_CHANGES"
      )
        throw new HttpError(
          409,
          "The repair must answer the latest saved correction request.",
        );
      if (
        c.sourceId !== previous.sourceId ||
        c.sourceHash !== previous.sourceHash ||
        c.kind !== previous.kind ||
        c.revisionHash === previous.revisionHash ||
        previous.regions.some(
          (region) => !c.regions.some((next) => next.page === region.page),
        )
      )
        throw new HttpError(
          409,
          "A repair needs a new extraction of the same source and reviewed pages.",
        );
      if (await this.replacementId(sql, previous.id))
        throw new HttpError(
          409,
          "A repaired version already answers this request.",
        );
    }
    await sql.query(
      "INSERT INTO extraction_staging.candidates(id,payload,payload_hash) VALUES($1,$2::jsonb,$3)",
      [c.id, JSON.stringify(c), digest(c)],
    );
    return c.id;
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
