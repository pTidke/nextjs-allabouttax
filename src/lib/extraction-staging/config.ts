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
    environmentId = env.EXTRACTION_STAGING_ENVIRONMENT_ID,
    objectRoot = env.EXTRACTION_STAGING_OBJECT_ROOT;
  if (
    !databaseUrl ||
    !productionUrl ||
    !environmentId ||
    !/^[A-Za-z0-9_-]{8,100}$/.test(environmentId) ||
    !objectRoot ||
    !path.isAbsolute(objectRoot)
  )
    throw new Error(
      "Staging needs its own database, environment ID and private object root.",
    );
  if (identity(databaseUrl) === identity(productionUrl))
    throw new Error(
      "Staging must use a different database from the live application.",
    );
  return { databaseUrl, environmentId, objectRoot };
}
import path from "node:path";
