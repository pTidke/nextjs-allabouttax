import "./env";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import { stagingConfig } from "../src/lib/extraction-staging/config";
import { database } from "../src/lib/extraction-staging/runtime";
import { ExtractionStore } from "../src/lib/extraction-staging/store";
import { evidenceReader } from "../src/lib/extraction-staging/objects";
import { candidateFromBundle } from "../src/lib/extraction-staging/import-bundle";
import { prepareBundle } from "../src/lib/extraction-staging/bundle-plan";
import { uploadCandidates } from "../src/lib/extraction-staging/upload";
async function main() {
  const [action, ...args] = process.argv.slice(2);
  const options = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    if (!args[i].startsWith("--") || !args[i + 1])
      throw new Error("Use named arguments with values.");
    if (options.has(args[i])) throw new Error("Duplicate operator argument.");
    options.set(args[i], args[i + 1]);
  }
  const python =
    process.env.EXTRACTION_STAGING_PYTHON ||
    path.resolve("tools/pdf_pipeline/.venv/bin/python");
  if (action === "plan" || action === "upload") {
    const bundle = options.get("--bundle");
    if (!bundle) throw new Error("Select an operator bundle.");
    const prepared = await prepareBundle(
      bundle,
      python,
      options.has("--max-bytes")
        ? Number(options.get("--max-bytes"))
        : undefined,
    );
    const report = {
      scopes: prepared.candidates.map((c) => ({
        id: c.id,
        state: c.state,
        regions: c.regions.length,
        blanks: c.regions.filter((r) => r.state === "blank").length,
        blockingHolds: c.blockingHolds,
      })),
      ...prepared.plan,
      cloudActivated: false,
    };
    if (action === "plan") {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    const config = stagingConfig();
    if (
      !config ||
      config.objects.kind !== "neon-s3" ||
      options.get("--confirm-environment") !== config.environmentId
    )
      throw new Error(
        "Confirm the exact isolated Neon environment before uploading.",
      );
    const accessKeyId = process.env.EXTRACTION_STAGING_UPLOAD_ACCESS_KEY_ID,
      secretAccessKey = process.env.EXTRACTION_STAGING_UPLOAD_SECRET_ACCESS_KEY;
    if (
      !accessKeyId ||
      !secretAccessKey ||
      accessKeyId === config.objects.accessKeyId
    )
      throw new Error(
        "Use separate operator upload credentials, never the runtime read credential.",
      );
    const { readObject } =
      await import("../src/lib/extraction-staging/evidence");
    const result = await uploadCandidates(
      { ...config.objects, accessKeyId, secretAccessKey },
      prepared.candidates,
      (ref) => readObject(prepared.root, ref),
      prepared.plan.maxBytes,
    );
    console.log(
      JSON.stringify(
        { ...report, ...result, uploadedToStaging: true },
        null,
        2,
      ),
    );
    return;
  }
  const config = stagingConfig();
  if (!config)
    throw new Error(
      "Explicitly enable and configure the isolated staging environment first.",
    );
  if (!["init", "import", "grant", "revoke"].includes(action))
    throw new Error("Choose plan, upload, init, import, grant or revoke.");
  const pool = new Pool({
    connectionString: config.databaseUrl,
    max: 1,
    connectionTimeoutMillis: 5000,
  });
  try {
    const db = database(pool),
      reader = evidenceReader(config.objects),
      store = new ExtractionStore(db, config.environmentId, (c) =>
        reader.verify(c),
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
        (config.objects.kind === "local" &&
          path.resolve(bundle, "registry", "objects") !==
            path.resolve(config.objects.root))
      )
        throw new Error(
          "The bundle must match the configured staging object root.",
        );
      const files = (await readdir(bundle)).filter((f) =>
        f.endsWith("-envelope.json"),
      );
      if (!files.length || files.length > 20)
        throw new Error("Invalid staging envelope inventory.");
      const fileSelection = options.get("--envelope");
      const replacesCandidateId = options.get("--replaces");
      const requestRevisionId = options.get("--request-revision");
      const description = options.get("--repair-summary");
      const linked = Boolean(
        replacesCandidateId || requestRevisionId || description,
      );
      if (fileSelection && !files.includes(fileSelection))
        throw new Error("The selected envelope is missing.");
      if (
        linked &&
        !(
          fileSelection &&
          replacesCandidateId &&
          requestRevisionId &&
          description
        )
      )
        throw new Error(
          "A repair needs an envelope, previous candidate, saved request and summary.",
        );
      for (const file of fileSelection ? [fileSelection] : files) {
        const c = await candidateFromBundle(
          bundle,
          file,
          process.env.EXTRACTION_STAGING_PYTHON ||
            path.resolve("tools/pdf_pipeline/.venv/bin/python"),
        );
        await store.register(
          replacesCandidateId && requestRevisionId && description
            ? {
                ...c,
                repair: { replacesCandidateId, requestRevisionId, description },
              }
            : c,
        );
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
