import "./env";
import { Client } from "pg";
import { prisma } from "../src/lib/db";
import {
  importLegacyAuth,
  type LegacyAuthSnapshot,
} from "../src/lib/operations/auth-import";
import { productionDatabaseUrl } from "./production-db";
async function main() {
  const url = await productionDatabaseUrl();
  const source = new Client({
    connectionString: url,
    connectionTimeoutMillis: 15000,
  });
  await source.connect();
  try {
    await source.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const { rows } = await source.query(
      'SELECT md5(lower(email)) AS identity FROM "User"',
    );
    const target = await prisma.$queryRaw<
      { identity: string }[]
    >`SELECT md5(lower(email)) AS identity FROM "User"`;
    const matches = rows.filter((r) =>
      target.some((t) => t.identity === r.identity),
    ).length;
    console.log({
      sourceUsers: rows.length,
      targetUsers: target.length,
      overlappingEmails: matches,
      newUsers: rows.length - matches,
    });
    if (!process.argv.includes("--apply")) {
      console.log(
        "Read-only plan; no user records or connection settings changed.",
      );
      return;
    }
    if (rows.length > 10000)
      throw new Error("Source too large for this bounded import.");
    const snapshot: LegacyAuthSnapshot = {
      users: (await source.query('SELECT * FROM "User"')).rows,
      accounts: (await source.query('SELECT * FROM "Account"')).rows,
      sessions: (await source.query('SELECT * FROM "Session"')).rows,
      verificationTokens: (
        await source.query('SELECT * FROM "VerificationToken"')
      ).rows,
    };
    const result = await prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(740129)::text`;
        return importLegacyAuth(tx, snapshot);
      },
      { timeout: 120000 },
    );
    console.log({ imported: true, ...result, sourcePreserved: true });
  } finally {
    await source.query("ROLLBACK");
    await source.end();
  }
}
main()
  .catch(() => {
    console.error(
      "Import stopped without exposing account records or credentials. Inspect the schema and identity conflicts before retrying.",
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
