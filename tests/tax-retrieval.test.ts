import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { PrismaPGlite } from "pglite-prisma-adapter";
import { PrismaClient } from "@prisma/client";
import { equivalentPeriods } from "../src/lib/tax/registry";

const database = new PGlite();
const db = new PrismaClient({ adapter: new PrismaPGlite(database) });
let ingestion: typeof import("../src/lib/tax/ingestion");
let review: typeof import("../src/lib/tax/review");
let retrieval: typeof import("../src/lib/tax/retrieval");
let coverage: typeof import("../src/lib/tax/coverage");
before(async () => {
  for (const name of (await readdir("prisma/migrations")).sort())
    if (!name.endsWith(".toml"))
      await database.exec(
        await readFile(`prisma/migrations/${name}/migration.sql`, "utf8"),
      );
  (globalThis as unknown as { prisma: PrismaClient }).prisma = db;
  ingestion = await import("../src/lib/tax/ingestion");
  review = await import("../src/lib/tax/review");
  retrieval = await import("../src/lib/tax/retrieval");
  coverage = await import("../src/lib/tax/coverage");
});
after(async () => {
  await db.$disconnect();
  await database.close();
});

// Publish one synthetic document for a single period and return its version id.
async function publish(id: string, text: string, period: string) {
  const url = `https://www.incometax.gov.in/${id}`;
  await db.taxSource.create({
    data: { id, name: id, url, kind: "DOCUMENT" },
  });
  await ingestion.enqueueRefresh(id);
  await ingestion.runNextJob(async (requested) => ({
    bytes: Buffer.from(
      `<html><title>${id}</title><article><h1>${id}</h1><p>${text.repeat(8)}</p></article></html>`,
    ),
    contentType: "text/html",
    url: requested,
  }));
  const version = await db.taxVersion.findFirstOrThrow({
    where: { document: { url } },
  });
  await review.reviewVersion(
    {
      versionId: version.id,
      action: "approve",
      sectionIds: ["full-document"],
      documentType: "GUIDANCE",
      legalStatus: "GUIDANCE",
      period,
      effectiveFrom: "2026-04-01",
      note: "Synthetic reviewed test only.",
    },
    "reviewer",
  );
  return version.id;
}
const found = async (question: string, period: string, earlier?: string[]) =>
  (await retrieval.retrieveEvidence(question, period, earlier)).evidence.map(
    (e) => e.versionId,
  );

let taxYear: string;
test("FY, TY and AY labels for the same income year reach the same evidence", async () => {
  assert.deepEqual(equivalentPeriods("AY 2027-28"), [
    "FY 2026-27",
    "TY 2026-27",
    "AY 2027-28",
  ]);
  assert.deepEqual(equivalentPeriods("TY 2099-00"), [
    "FY 2099-00",
    "TY 2099-00",
    "AY 2100-01",
  ]);
  taxYear = await publish(
    "tax-year-guidance",
    "A tax year means the twelve month period of the financial year commencing on the first day of April. ",
    "TY 2026-27",
  );
  for (const same of ["TY 2026-27", "FY 2026-27", "AY 2027-28"]) {
    assert.deepEqual(
      [...new Set(await found("What is a tax year?", same))],
      [taxYear],
      `${same} names April 2026 to March 2027`,
    );
    const library = await coverage.knowledgeCoverage(same);
    assert.equal(library.availableDocuments, 1, `${same} coverage`);
  }
  // A neighbouring income year must still find nothing.
  for (const other of [
    "AY 2026-27",
    "FY 2025-26",
    "TY 2027-28",
    "AY 2028-29",
  ]) {
    assert.deepEqual(await found("What is a tax year?", other), [], other);
    const library = await coverage.knowledgeCoverage(other);
    assert.equal(library.availableDocuments, 0, `${other} coverage`);
  }
});

test("a follow-up question is searched together with the earlier questions of the chat", async () => {
  const advanceTax = await publish(
    "advance-tax-guidance",
    "Advance tax instalments are payable by the fifteenth of June, September, December and March. ",
    "TY 2026-27",
  );
  const period = "FY 2026-27";
  const followUp = "and how long is it?";
  // By itself the follow-up has no subject, which is why it used to dead-end.
  assert.deepEqual(await found(followUp, period), []);
  assert.equal(
    (await found(followUp, period, ["What is a tax year?"]))[0],
    taxYear,
    "the earlier question supplies the subject",
  );
  // Only the last few questions are passed in; an unrelated older one changes nothing here.
  assert.equal(
    (
      await found(followUp, period, [
        "What is a tax year?",
        "When are advance tax instalments payable?",
      ])
    ).includes(taxYear),
    true,
  );
  // A question on a new subject is not pulled back to the earlier one.
  assert.equal(
    (
      await found("When are advance tax instalments payable?", period, [
        "What is a tax year?",
      ])
    )[0],
    advanceTax,
    "the current question outweighs earlier ones",
  );
  // A message with no searchable words falls back to the earlier questions.
  assert.equal(
    (await found("and?", period, ["What is a tax year?"]))[0],
    taxYear,
  );
  assert.deepEqual(await found("and?", period), []);
  // Earlier questions never widen the period.
  assert.deepEqual(
    await found(followUp, "FY 2025-26", ["What is a tax year?"]),
    [],
  );
});

test("search terms drop filler words and anything already in the current question", () => {
  assert.equal(retrieval.searchTerms("What is a tax year?"), "is | tax | year");
  assert.equal(
    retrieval.searchTerms(
      "What is a tax year? And the previous year?",
      "is | tax | year",
    ),
    "previous",
  );
  assert.equal(retrieval.searchTerms("टैक्स ईयर क्या है?"), "");
});
