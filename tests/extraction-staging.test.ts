import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { HttpError } from "../src/lib/http";
import {
  digest,
  parseCommand,
  validateCandidate,
  type Candidate,
  type Command,
} from "../src/lib/extraction-staging/contract";
import {
  ExtractionStore,
  type Database,
  type Sql,
} from "../src/lib/extraction-staging/store";
import { createHandlers } from "../src/lib/extraction-staging/handlers";
import { createAssetHandler } from "../src/lib/extraction-staging/assets";
import { stagingConfig } from "../src/lib/extraction-staging/config";
import { readObject } from "../src/lib/extraction-staging/evidence";

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const ref = (s: string) => ({ object_id: s, sha256: hash(s) });
function fixture(name = "native"): Candidate {
  const original = ref("original"),
    render = ref("render");
  return {
    id: hash(name),
    sourceId: name,
    sourceHash: original.sha256,
    runId: "run-1",
    revisionHash: hash("revision"),
    title: "Public engineering fixture",
    officialUrl: "https://www.incometax.gov.in/source",
    scopeNote: "Page one only; an engineering fixture, not tax approval.",
    kind: "native_full_pages",
    state: "AWAITING_EXTRACTION_REVIEW",
    blockingHolds: [],
    reviewHolds: ["CHECK_CRITICAL_CHARACTERS"],
    original,
    evidence: [original, render, ref("revision")],
    renders: [{ page: 1, object: render, width: 600, height: 800 }],
    regions: [
      {
        id: "p1-b1",
        page: 1,
        raw: "29th",
        proposed: "29th",
        state: "transcribed",
        note: "",
        box: { x0: 10, top: 10, x1: 100, bottom: 40 },
      },
    ],
  };
}
function command(c: Candidate, edit: Partial<Command> = {}): Command {
  return {
    candidateId: c.id,
    parentRevision: null,
    requestId: randomUUID(),
    action: "SAVE_DRAFT",
    note: "Checked the source image.",
    checks: [],
    readingOrderChecked: false,
    contextChecked: false,
    criticalCharactersChecked: false,
    ...edit,
  };
}
function status(code: number) {
  return (e: unknown) => e instanceof HttpError && e.status === code;
}

test("isolated extraction staging persists authenticated, immutable decisions in Postgres", async (t) => {
  const pg = new PGlite();
  try {
    await pg.exec(
      await readFile("tools/extraction-staging/schema.sql", "utf8"),
    );
    await pg.query(
      "INSERT INTO extraction_staging.environment(environment_id) VALUES($1)",
      ["test-stage"],
    );
    const db: Database = {
      query: (q, p) => pg.query(q, p),
      transaction: (fn) =>
        pg.transaction((tx) => fn({ query: (q, p) => tx.query(q, p) } as Sql)),
    };
    let damaged = false,
      verifications = 0;
    const store = new ExtractionStore(db, "test-stage", async () => {
      verifications++;
      if (damaged) throw new Error("Evidence hash changed");
    });
    const c = fixture();
    await store.register(c);
    const expires = new Date(Date.now() + 86400000).toISOString();
    await t.test(
      "sign-in and administrator status alone grant no review access",
      async () => {
        await assert.rejects(store.list(""), status(401));
        await assert.rejects(store.list("administrator"), status(403));
        await assert.rejects(
          store.save("administrator", command(c)),
          status(403),
        );
        await store.capability(
          "reviewer-a",
          "GRANT",
          "Engineering review",
          expires,
        );
        await store.capability(
          "reviewer-b",
          "GRANT",
          "Second engineering reviewer",
          expires,
        );
        assert.equal((await store.list("reviewer-a")).length, 1);
        await assert.rejects(
          new ExtractionStore(db, "wrong-stage", async () => {}).list(
            "reviewer-a",
          ),
          /Wrong staging/,
        );
      },
    );
    await t.test(
      "registered evidence is immutable and imports are idempotent",
      async () => {
        assert.equal(await store.register(c), c.id);
        await assert.rejects(
          store.register({ ...c, title: "Changed" }),
          status(409),
        );
        await assert.rejects(
          pg.query(
            "UPDATE extraction_staging.candidates SET payload_hash=$1 WHERE id=$2",
            [hash("fake"), c.id],
          ),
          /immutable/,
        );
        await assert.rejects(
          pg.query("DELETE FROM extraction_staging.candidates WHERE id=$1", [
            c.id,
          ]),
          /immutable/,
        );
      },
    );
    const firstCommand = command(c),
      first = await store.save("reviewer-a", firstCommand);
    await t.test(
      "server assigns reviewer, time and source-bound revision; retry returns the same record",
      async () => {
        assert.equal(first.revision.actorId, "reviewer-a");
        assert.ok(first.revision.serverStamp);
        assert.equal(first.revision.parentRevision, null);
        assert.equal(first.publicationEligible, false);
        assert.equal(first.taxApproved, false);
        assert.equal(first.retrievalItemsCreated, 0);
        const retry = await store.save("reviewer-a", firstCommand);
        assert.equal(retry.revision.id, first.revision.id);
        assert.equal(
          (await store.get("reviewer-a", c.id)).history.revisions.length,
          1,
        );
        await assert.rejects(
          store.save("reviewer-a", {
            ...firstCommand,
            note: "Different content",
          }),
          status(409),
        );
        await assert.rejects(store.save("reviewer-b", command(c)), status(409));
        await assert.rejects(
          store.save("reviewer-a", { ...command(c), actorId: "other" }),
          status(400),
        );
        await assert.rejects(
          store.save("reviewer-a", { ...command(c), taxApproved: true }),
          status(400),
        );
      },
    );
    await t.test(
      "incomplete checks, unknown regions and altered evidence cannot accept a scope",
      async () => {
        await assert.rejects(
          store.save(
            "reviewer-a",
            command(c, {
              parentRevision: first.revision.id,
              action: "ACCEPT_EXTRACTION",
            }),
          ),
          status(409),
        );
        await assert.rejects(
          store.save(
            "reviewer-a",
            command(c, {
              parentRevision: first.revision.id,
              checks: [{ regionId: "foreign", state: "checked" }],
            }),
          ),
          status(400),
        );
        await assert.rejects(
          store.save(
            "reviewer-a",
            command(c, {
              parentRevision: first.revision.id,
              checks: [
                { regionId: "p1-b1", state: "checked" },
                { regionId: "p1-b1", state: "checked" },
              ],
            }),
          ),
          status(400),
        );
        damaged = true;
        await assert.rejects(store.get("reviewer-a", c.id), /Evidence hash/);
        await assert.rejects(
          store.save("reviewer-a", firstCommand),
          /Evidence hash/,
        );
        await assert.rejects(
          store.save(
            "reviewer-a",
            command(c, { parentRevision: first.revision.id }),
          ),
          /Evidence hash/,
        );
        damaged = false;
        assert.equal(
          (await store.get("reviewer-a", c.id)).history.revisions.length,
          1,
        );
      },
    );
    const acceptedCommand = command(c, {
      parentRevision: first.revision.id,
      action: "ACCEPT_EXTRACTION",
      checks: [{ regionId: "p1-b1", state: "checked" }],
      readingOrderChecked: true,
      contextChecked: true,
      criticalCharactersChecked: true,
    });
    const accepted = await store.save("reviewer-b", acceptedCommand);
    await t.test(
      "complete source acceptance remains separate from legal approval and retrieval",
      async () => {
        assert.equal(accepted.revision.actorId, "reviewer-b");
        assert.equal(accepted.revision.parentRevision, first.revision.id);
        assert.equal(accepted.revision.command.action, "ACCEPT_EXTRACTION");
        assert.equal(accepted.taxApproved, false);
        assert.equal(accepted.publicationEligible, false);
        const newer = await store.save(
          "reviewer-a",
          command(c, {
            parentRevision: accepted.revision.id,
            note: "Re-opened source check",
          }),
        );
        assert.equal(newer.revision.command.action, "SAVE_DRAFT");
        const retry = await store.save("reviewer-b", acceptedCommand);
        assert.equal(retry.revision.id, accepted.revision.id);
        assert.equal(retry.headRevision, newer.revision.id);
        const current = await store.get("reviewer-a", c.id);
        assert.equal(current.history.revisions[0].command.action, "SAVE_DRAFT");
        assert.equal(current.history.revisions.length, 3);
        await assert.rejects(
          pg.query(
            "UPDATE extraction_staging.revisions SET action='ACCEPT_EXTRACTION'",
          ),
          /immutable/,
        );
        await assert.rejects(
          pg.query("DELETE FROM extraction_staging.revisions"),
          /immutable/,
        );
        await pg.query(
          "UPDATE extraction_staging.heads SET revision_id=$1 WHERE candidate_id=$2",
          [first.revision.id, c.id],
        );
        await assert.rejects(store.get("reviewer-a", c.id), /rolled-back/);
        await pg.query(
          "UPDATE extraction_staging.heads SET revision_id=$1 WHERE candidate_id=$2",
          [newer.revision.id, c.id],
        );
      },
    );
    await t.test(
      "confirmed blanks do not remove a partial table's blocking holds",
      async () => {
        const table = fixture("table");
        table.kind = "image_table_band";
        table.state = "BLOCKED";
        table.blockingHolds = ["UNPLACED_MATERIAL_TEXT", "MISSING_CONTEXT"];
        table.regions[0] = {
          ...table.regions[0],
          state: "blank",
          raw: null,
          proposed: "",
        };
        await store.register(table);
        const edit = command(table, {
          checks: [{ regionId: "p1-b1", state: "checked" }],
          readingOrderChecked: true,
          contextChecked: true,
          criticalCharactersChecked: true,
        });
        await assert.rejects(
          store.save("reviewer-a", { ...edit, action: "ACCEPT_EXTRACTION" }),
          status(409),
        );
        await store.save("reviewer-a", edit);
        const saved = await store.get("reviewer-a", table.id);
        assert.equal(saved.candidate.regions[0].proposed, "");
        assert.equal(saved.candidate.regions[0].raw, null);
        assert.equal(saved.candidate.regions[0].state, "blank");
        assert.deepEqual(saved.candidate.blockingHolds, table.blockingHolds);
        assert.equal(saved.retrievalItemsCreated, 0);
      },
    );
    await t.test(
      "revocation and expiry apply to every subsequent read and write",
      async () => {
        await store.capability("reviewer-b", "REVOKE", "End of sample review");
        await assert.rejects(store.get("reviewer-b", c.id), status(403));
        await assert.rejects(
          store.save("reviewer-b", acceptedCommand),
          status(403),
        );
        await store.capability("expired", "GRANT", "Expiry test", expires);
        await pg.query(
          "UPDATE extraction_staging.capabilities SET expires_at=now()-interval '1 second' WHERE user_id='expired'",
        );
        await assert.rejects(store.list("expired"), status(403));
        await assert.rejects(
          store.capability(
            "forever",
            "GRANT",
            "No permanent grants",
            new Date(Date.now() + 91 * 86400000).toISOString(),
          ),
        );
        await assert.rejects(
          pg.query("DELETE FROM extraction_staging.capability_events"),
          /immutable/,
        );
        assert.ok(verifications >= 10);
      },
    );
    await t.test(
      "HTTP boundary uses the signed-in principal and rejects client authority claims",
      async () => {
        let enabled = false,
          principal: { id: string } | null = null,
          reads = 0;
        const api = createHandlers({
          enabled: () => enabled,
          principal: async () => {
            reads++;
            return principal;
          },
          store: () => store,
        });
        const url = "https://review.example/api/staging/extraction";
        const post = (
          body: unknown,
          origin = new URL(process.env.AUTH_URL || url).origin,
        ) =>
          new Request(url, {
            method: "POST",
            headers: { "Content-Type": "application/json", Origin: origin },
            body: JSON.stringify(body),
          });
        assert.equal((await api.GET(new Request(url))).status, 404);
        assert.equal((await api.POST(post({}))).status, 404);
        assert.equal(reads, 0);
        enabled = true;
        assert.equal((await api.GET(new Request(url))).status, 401);
        principal = { id: "administrator" };
        assert.equal((await api.GET(new Request(url))).status, 403);
        principal = { id: "reviewer-a" };
        assert.equal(
          (await api.POST(post(command(c), "https://attacker.example"))).status,
          403,
        );
        assert.equal(
          (await api.POST(post({ ...command(c), userId: "reviewer-b" })))
            .status,
          400,
        );
        assert.equal(
          (await api.POST(post({ ...command(c), registry: "/tmp/path" })))
            .status,
          400,
        );
        assert.equal(
          (await api.POST(post({ note: "x".repeat(128 * 1024) }))).status,
          413,
        );
        assert.equal(
          (await api.GET(new Request(url + "?candidateId=../../file"))).status,
          400,
        );
        const response = await api.GET(
          new Request(url + "?candidateId=" + c.id),
        );
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("Cache-Control"), "no-store");
        const view = await response.json();
        const result = await api.POST(
          post(
            command(c, {
              parentRevision: view.history.headRevision,
              note: "Saved through authenticated boundary",
            }),
          ),
        );
        assert.equal(result.status, 200);
        assert.equal((await result.json()).revision.actorId, "reviewer-a");
      },
    );
    await t.test(
      "source files require a current grant and cannot expose raw or arbitrary objects",
      async () => {
        let enabled = false,
          principal: { id: string } | null = null,
          reads = 0;
        const asset = createAssetHandler({
          enabled: () => enabled,
          principal: async () => principal,
          store: () => store,
          readEvidence: async (ref) => {
            reads++;
            return ref.object_id === "original"
              ? Buffer.from("%PDF-fixture")
              : Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
          },
        });
        assert.equal((await asset(c.id, "original")).status, 404);
        enabled = true;
        assert.equal((await asset(c.id, "original")).status, 401);
        principal = { id: "administrator" };
        assert.equal((await asset(c.id, "original")).status, 403);
        principal = { id: "reviewer-b" };
        assert.equal((await asset(c.id, "original")).status, 403);
        assert.equal(reads, 0);
        principal = { id: "reviewer-a" };
        assert.equal((await asset(c.id, "../secret")).status, 400);
        assert.equal((await asset(c.id, "revision")).status, 404);
        assert.equal((await asset(hash("foreign"), "original")).status, 404);
        assert.equal(reads, 0);
        const pdf = await asset(c.id, "original");
        assert.equal(pdf.status, 200);
        assert.equal(pdf.headers.get("Content-Type"), "application/pdf");
        assert.match(pdf.headers.get("Content-Disposition")!, /attachment/);
        const png = await asset(c.id, "render");
        assert.equal(png.status, 200);
        assert.equal(png.headers.get("Cache-Control"), "no-store");
        assert.match(png.headers.get("Content-Security-Policy")!, /sandbox/);
      },
    );
    await t.test(
      "two competing saves from the same parent produce one revision and one conflict",
      async () => {
        const concurrent = fixture("concurrent");
        await store.register(concurrent);
        const results = await Promise.allSettled([
          store.save("reviewer-a", command(concurrent)),
          store.save("reviewer-a", command(concurrent)),
        ]);
        assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
        const conflict = results.find((r) => r.status === "rejected");
        assert.ok(
          conflict?.status === "rejected" && status(409)(conflict.reason),
        );
        assert.equal(
          (await store.get("reviewer-a", concurrent.id)).history.revisions
            .length,
          1,
        );
      },
    );
    await t.test(
      "a restricted runtime database role can review but cannot import or assign capabilities",
      async () => {
        await pg.exec(`CREATE ROLE extraction_runtime;
        GRANT USAGE ON SCHEMA extraction_staging TO extraction_runtime;
        GRANT SELECT ON extraction_staging.environment, extraction_staging.capabilities,
          extraction_staging.candidates, extraction_staging.revisions, extraction_staging.heads TO extraction_runtime;
        GRANT INSERT ON extraction_staging.revisions TO extraction_runtime;
        GRANT INSERT, UPDATE ON extraction_staging.heads TO extraction_runtime;
        SET ROLE extraction_runtime;`);
        try {
          const current = await store.get("reviewer-a", c.id);
          const saved = await store.save(
            "reviewer-a",
            command(c, {
              parentRevision: current.history.headRevision,
              note: "Saved using restricted database role",
            }),
          );
          assert.equal(saved.revision.actorId, "reviewer-a");
          await assert.rejects(
            store.capability(
              "self-appointed",
              "GRANT",
              "Not permitted",
              expires,
            ),
            /permission denied/,
          );
          await assert.rejects(
            store.register(fixture("not-permitted")),
            /permission denied/,
          );
          await assert.rejects(
            pg.query(
              "UPDATE extraction_staging.revisions SET action='ACCEPT_EXTRACTION'",
            ),
            /permission denied/,
          );
        } finally {
          await pg.exec("RESET ROLE");
        }
      },
    );
  } finally {
    await pg.close();
  }
});

test("staging configuration is disabled by default and rejects the live database, including pooled aliases", () => {
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://live:secret@ep-live.neon.tech/neondb",
    EXTRACTION_STAGING_ENABLED: "true",
    EXTRACTION_STAGING_DATABASE_URL:
      "postgresql://other:secret@ep-stage.neon.tech/neondb",
    EXTRACTION_STAGING_ENVIRONMENT_ID: "stage-test",
    EXTRACTION_STAGING_OBJECT_ROOT: "/tmp/evidence",
  };
  assert.equal(stagingConfig({ NODE_ENV: "test" }), null);
  assert.ok(stagingConfig(env));
  assert.throws(
    () =>
      stagingConfig({
        ...env,
        EXTRACTION_STAGING_DATABASE_URL:
          "postgresql://different:secret@ep-live-pooler.neon.tech:5432/neondb?sslmode=require",
      }),
    /different database/,
  );
  assert.throws(() =>
    stagingConfig({ ...env, EXTRACTION_STAGING_ENVIRONMENT_ID: undefined }),
  );
  assert.throws(() =>
    stagingConfig({ ...env, EXTRACTION_STAGING_OBJECT_ROOT: "relative/path" }),
  );
  assert.throws(() =>
    stagingConfig({ ...env, DATABASE_URL: "prisma://unverifiable" }),
  );
});

test("source integrity validation binds originals, renders and region geometry to registered evidence", () => {
  assert.ok(validateCandidate(fixture()));
  const bad: Candidate[] = [];
  let c = fixture();
  c.evidence = c.evidence.filter((x) => x.object_id !== "render");
  bad.push(c);
  c = fixture();
  c.sourceHash = hash("other");
  bad.push(c);
  c = fixture();
  c.evidence.push({ object_id: "original", sha256: hash("foreign") });
  bad.push(c);
  c = fixture();
  c.renders.push(c.renders[0]);
  bad.push(c);
  c = fixture();
  c.regions[0].box.x1 = 1000;
  bad.push(c);
  c = fixture();
  c.officialUrl = "https://www.incometax.gov.in:444/source";
  bad.push(c);
  for (const item of bad) assert.throws(() => validateCandidate(item));
  assert.equal(digest({ a: 1, b: 2 }), digest({ b: 2, a: 1 }));
  assert.throws(() =>
    parseCommand({
      ...command(fixture()),
      checks: [{ regionId: "x", state: "accepted" }],
    }),
  );
  assert.throws(() =>
    parseCommand({ ...command(fixture()), action: ["SAVE_DRAFT"] }),
  );
});

test("private object adapter detects changed bytes, symlinks and filesystem paths", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "extraction-evidence-"));
  try {
    const bytes = Buffer.from("public fixture bytes"),
      sha256 = hash(bytes.toString()),
      reference = { object_id: "original", sha256 };
    const file = path.join(root, sha256 + ".blob");
    await writeFile(file, bytes);
    assert.deepEqual(await readObject(root, reference), bytes);
    await writeFile(file, "changed");
    await assert.rejects(readObject(root, reference), /changed/);
    await rm(file);
    await writeFile(path.join(root, "other"), bytes);
    await symlink(path.join(root, "other"), file);
    await assert.rejects(readObject(root, reference));
    await assert.rejects(readObject(root, { object_id: "../secret", sha256 }));
    await symlink(root, root + "-alias");
    await assert.rejects(readObject(root + "-alias", reference), /symlink/);
  } finally {
    await rm(root + "-alias", { force: true });
    await rm(root, { recursive: true, force: true });
  }
});
