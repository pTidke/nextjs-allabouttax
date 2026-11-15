import path from "node:path";
export type EvidenceConfig =
  | { kind: "local"; root: string }
  | {
      kind: "neon-s3";
      endpoint: string;
      branchId: string;
      region: string;
      bucket: string;
      prefix: string;
      accessKeyId: string;
      secretAccessKey: string;
    };
export function evidenceConfig(
  env: NodeJS.ProcessEnv,
  environmentId: string,
): EvidenceConfig {
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(environmentId))
    throw new Error("Invalid staging environment ID.");
  const kind = env.EXTRACTION_STAGING_OBJECT_BACKEND || "local";
  if (kind === "local") {
    const root = env.EXTRACTION_STAGING_OBJECT_ROOT;
    if (!root || !path.isAbsolute(root))
      throw new Error("A private absolute object root is required.");
    if (env.VERCEL === "1")
      throw new Error("Local evidence is not durable on Vercel.");
    return { kind, root };
  }
  if (kind !== "neon-s3")
    throw new Error("Unsupported staging object backend.");
  const endpoint = new URL(env.EXTRACTION_STAGING_S3_ENDPOINT || ""),
    branchId = env.EXTRACTION_STAGING_BRANCH_ID || "",
    region = env.EXTRACTION_STAGING_S3_REGION || "",
    bucket = env.EXTRACTION_STAGING_S3_BUCKET || "",
    accessKeyId = env.EXTRACTION_STAGING_S3_ACCESS_KEY_ID || "",
    secretAccessKey = env.EXTRACTION_STAGING_S3_SECRET_ACCESS_KEY || "";
  if (
    !/^br-[a-z0-9-]+$/.test(branchId) ||
    !["us-east-2", "us-east-1", "eu-central-1", "ap-southeast-1"].includes(
      region,
    ) ||
    !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket) ||
    !accessKeyId ||
    !secretAccessKey ||
    endpoint.protocol !== "https:" ||
    endpoint.username ||
    endpoint.password ||
    endpoint.port ||
    endpoint.search ||
    endpoint.hash ||
    endpoint.pathname !== "/" ||
    !new RegExp(
      "^" +
        branchId +
        "\\.storage\\.c-[0-9]+\\." +
        region +
        "\\.aws\\.neon\\.tech$",
    ).test(endpoint.hostname)
  )
    throw new Error(
      "Use an explicitly pinned Neon staging branch, region, private bucket and credentials.",
    );
  return {
    kind,
    endpoint: endpoint.origin,
    branchId,
    region,
    bucket,
    accessKeyId,
    secretAccessKey,
    prefix: "extraction/" + environmentId + "/objects/",
  };
}

function identity(input: string) {
  const u = new URL(input);
  if (!["postgres:", "postgresql:"].includes(u.protocol))
    throw new Error(
      "A direct Postgres connection is required for isolation checks.",
    );
  return [
    u.hostname.toLowerCase().replace(/-pooler(?=\.)/, ""),
    u.port || "5432",
    decodeURIComponent(u.pathname),
  ].join(":");
}
export function stagingConfig(env: NodeJS.ProcessEnv = process.env) {
  if (env.EXTRACTION_STAGING_ENABLED !== "true") return null;
  const databaseUrl = env.EXTRACTION_STAGING_DATABASE_URL,
    productionUrl = env.DATABASE_URL,
    environmentId = env.EXTRACTION_STAGING_ENVIRONMENT_ID;
  if (
    !databaseUrl ||
    !productionUrl ||
    !environmentId ||
    !/^[A-Za-z0-9_-]{8,100}$/.test(environmentId)
  )
    throw new Error(
      "Staging needs explicit application/review databases and an environment ID.",
    );
  if (identity(databaseUrl) === identity(productionUrl))
    throw new Error(
      "Staging review must use a different database from the application.",
    );
  const objects = evidenceConfig(env, environmentId);
  const liveDatabaseIdentity = env.EXTRACTION_STAGING_LIVE_DATABASE_IDENTITY;
  if (objects.kind === "neon-s3") {
    if (!liveDatabaseIdentity)
      throw new Error(
        "Pin the actual live database identity before preparing cloud staging.",
      );
    const live = new URL(liveDatabaseIdentity);
    if (
      live.username ||
      live.password ||
      live.search ||
      live.hash ||
      identity(databaseUrl) === identity(liveDatabaseIdentity) ||
      identity(productionUrl) === identity(liveDatabaseIdentity)
    )
      throw new Error(
        "Cloud staging auth and review databases must both be isolated from the pinned live database.",
      );
  }
  return {
    databaseUrl,
    environmentId,
    objects,
    liveDatabaseIdentity: liveDatabaseIdentity || null,
  };
}
