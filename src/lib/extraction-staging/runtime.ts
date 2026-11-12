import { Pool } from "pg";
import { stagingConfig } from "./config";
import { ExtractionStore, type Database, type Sql } from "./store";
import { evidenceReader } from "./objects";
import type { ObjectRef } from "./contract";
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
  | {
      key: string;
      store: ExtractionStore;
      readEvidence: (ref: ObjectRef) => Promise<Buffer>;
    }
  | undefined;
export function stagingRuntime() {
  const config = stagingConfig();
  if (!config) throw new Error("Extraction staging is disabled.");
  const key = JSON.stringify(config);
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
  const reader = evidenceReader(config.objects);
  configured = {
    key,
    readEvidence: (ref) => reader.read(ref),
    store: new ExtractionStore(database(pool), config.environmentId, (c) =>
      reader.verify(c),
    ),
  };
  return configured;
}
