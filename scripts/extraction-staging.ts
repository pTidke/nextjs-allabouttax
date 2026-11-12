import "dotenv/config";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import { stagingConfig } from "../src/lib/extraction-staging/config";
import { database } from "../src/lib/extraction-staging/runtime";
import { ExtractionStore } from "../src/lib/extraction-staging/store";
import { verifyEvidence } from "../src/lib/extraction-staging/evidence";
import { candidateFromBundle } from "../src/lib/extraction-staging/import-bundle";
async function main() {
  const [action, ...args] = process.argv.slice(2),
    config = stagingConfig();
  if (!config)
    throw new Error(
      "Explicitly enable and configure the isolated staging environment first.",
    );
  const options = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    if (!args[i].startsWith("--") || !args[i + 1])
      throw new Error("Use named arguments with values.");
    options.set(args[i], args[i + 1]);
  }
  if (!["init", "import", "grant", "revoke"].includes(action))
    throw new Error("Choose init, import, grant or revoke.");
  const pool = new Pool({
    connectionString: config.databaseUrl,
    max: 1,
    connectionTimeoutMillis: 5000,
  });
  try {
    const db = database(pool),
      store = new ExtractionStore(db, config.environmentId, (c) =>
        verifyEvidence(config.objectRoot, c),
      );
    if (action === "init") {
      if (options.get("--confirm-isolated") !== config.environmentId)
        throw new Error(
          "Confirm the exact isolated environment ID before initializing.",
        );
      const schema = await readFile(
        "tools/extraction-staging/schema.sql",
        "utf8",
      );
      await db.transaction(async (sql) => {
        await sql.query(schema);
        await sql.query(
          "INSERT INTO extraction_staging.environment(singleton,environment_id) VALUES(true,$1) ON CONFLICT DO NOTHING",
          [config.environmentId],
        );
        const check = await sql.query(
          "SELECT environment_id FROM extraction_staging.environment",
        );
        if (
          check.rows.length !== 1 ||
          check.rows[0].environment_id !== config.environmentId
        )
          throw new Error("Wrong staging environment.");
      });
      console.log(
        "Isolated extraction schema initialized. No reviewer was granted access.",
      );
    } else if (action === "import") {
      const bundle = options.get("--bundle");
      if (
        !bundle ||
        path.resolve(bundle, "registry", "objects") !==
          path.resolve(config.objectRoot)
      )
        throw new Error(
          "The bundle must match the configured staging object root.",
        );
      const files = (await readdir(bundle)).filter((f) =>
        f.endsWith("-envelope.json"),
      );
      if (!files.length || files.length > 20)
        throw new Error("Invalid staging envelope inventory.");
      for (const file of files) {
        const c = await candidateFromBundle(
          bundle,
          file,
          process.env.EXTRACTION_STAGING_PYTHON ||
            path.resolve("tools/pdf_pipeline/.venv/bin/python"),
        );
        await store.register(c);
        console.log(
          JSON.stringify({
            draft: c.id,
            state: c.state,
            publicationEligible: false,
          }),
        );
      }
    } else {
      const user = options.get("--user-id"),
        reason = options.get("--reason");
      if (!user || !reason)
        throw new Error(
          "An explicit authenticated user ID and operator reason are required.",
        );
      await store.capability(
        user,
        action === "grant" ? "GRANT" : "REVOKE",
        reason,
        options.get("--expires-at"),
      );
      console.log(
        "Staging extraction capability updated. No tax capability exists in this tool.",
      );
    }
  } finally {
    await pool.end();
  }
}
main().catch(() => {
  console.error(
    "Staging operation failed. Check isolation, arguments and environment; connection values and document text are not printed.",
  );
  process.exitCode = 1;
});
