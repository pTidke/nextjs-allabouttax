import { Pool } from "pg";
import { stagingConfig } from "./config";
import { ExtractionStore, type Database, type Sql } from "./store";
import { verifyEvidence } from "./evidence";
export function database(pool: Pool): Database {
  return {
    query: async (text, params) => pool.query(text, params),
    transaction: async (fn) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL statement_timeout = '10s'");
        const result = await fn(client as Sql);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
let configured:
  { key: string; store: ExtractionStore; objectRoot: string } | undefined;
export function stagingRuntime() {
  const config = stagingConfig();
  if (!config) throw new Error("Extraction staging is disabled.");
  const key =
    config.databaseUrl + "|" + config.environmentId + "|" + config.objectRoot;
  if (configured) {
    if (configured.key !== key)
      throw new Error("Restart after changing the staging configuration.");
    return configured;
  }
  const pool = new Pool({
    connectionString: config.databaseUrl,
    max: 3,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 10000,
  });
  pool.on("error", () => {
    // Idle connection errors must not crash the web process or print connection details.
    console.error("Extraction staging database connection interrupted.");
  });
  configured = {
    key,
    objectRoot: config.objectRoot,
    store: new ExtractionStore(database(pool), config.environmentId, (c) =>
      verifyEvidence(config.objectRoot, c),
    ),
  };
  return configured;
}
