import { test } from "node:test";
import assert from "node:assert/strict";
import {
  discoverCbdt,
  parseCbdtDocument,
  type CbdtFetch,
} from "../src/lib/tax/cbdt";
import { fetchCbdtJson, type fetchOfficial } from "../src/lib/tax/fetch";
import { scheduleBucket, weeklyBucket } from "../src/lib/tax/scheduler";

const record = (id: number) => ({
  title: `Circular ${id}`,
  embedded: {
    id,
    contentFields: [
      {
        name: "reportFile",
        contentFieldValue: {
          document: { contentUrl: `/documents/d/guest/circular-${id}` },
        },
      },
      {
        name: "circularNotificationDate",
        contentFieldValue: { data: "2026-07-02T00:00:00Z" },
      },
    ],
  },
});
const html: typeof fetchOfficial = async (url) => ({
  url,
  contentType: "text/html",
  bytes: Buffer.from(
    `<script>Liferay.authToken = 'guest-test';</script><etds-circular-notification structureid="36050" structurekey="CIRCULAR_KEY"></etds-circular-notification>`,
  ),
});
const api =
  (search: (page: number) => unknown): CbdtFetch =>
  async (url, request) => {
    assert.equal(request.csrf, "guest-test");
    const u = new URL(url);
    if (u.pathname.endsWith("/taxonomy-vocabularies"))
      return {
        page: 1,
        lastPage: 1,
        totalCount: 1,
        items: [{ id: 38118, name: "Year" }],
      };
    if (u.pathname.endsWith("/taxonomy-categories"))
      return {
        page: 1,
        lastPage: 1,
        totalCount: 1,
        items: [{ id: 13590315, name: "2026" }],
      };
    assert.equal(
      (request.body as { attributes: Record<string, unknown> }).attributes[
        "search.experiences.year_id"
      ],
      "13590315",
    );
    return search(Number(u.searchParams.get("page")));
  };
const discover = (json: CbdtFetch) =>
  discoverCbdt(
    "https://www.incometaxindia.gov.in/circulars",
    html,
    json,
    2026,
    new Date("2026-09-28"),
  );
test("CBDT discovery follows every page and keeps official titles and issue dates", async () => {
  const calls: number[] = [];
  const docs = await discover(
    api((page) => {
      calls.push(page);
      return { page, lastPage: 2, totalCount: 2, items: [record(page)] };
    }),
  );
  assert.deepEqual(calls, [1, 2]);
  assert.equal(docs.length, 2);
  assert.equal(docs[1].title, "Circular 2");
  assert.equal(docs[0].issuedAt?.toISOString(), "2026-07-02T00:00:00.000Z");
});
test("CBDT discovery rejects repeated, missing, changed, and out-of-year results", async () => {
  await assert.rejects(
    discover(
      api((page) => ({ page, lastPage: 2, totalCount: 2, items: [record(1)] })),
    ),
    /repeated/,
  );
  await assert.rejects(
    discover(
      api((page) => ({ page, lastPage: 1, totalCount: 2, items: [record(1)] })),
    ),
    /omitted/,
  );
  await assert.rejects(
    discover(
      api((page) => ({
        page,
        lastPage: 2,
        totalCount: page,
        items: [record(page)],
      })),
    ),
    /changed/,
  );
  const wrong = record(1);
  wrong.embedded.contentFields[1].contentFieldValue.data = "2025-07-02";
  await assert.rejects(
    discover(
      api((page) => ({ page, lastPage: 1, totalCount: 1, items: [wrong] })),
    ),
    /year filter/,
  );
});
test("CBDT records and guest token requests cannot target unrelated hosts or APIs", async () => {
  const bad = record(1);
  bad.embedded.contentFields[0].contentFieldValue.document!.contentUrl =
    "https://evil.example/x.pdf";
  assert.throws(() => parseCbdtDocument(bad));
  await assert.rejects(
    fetchCbdtJson("https://www.incometax.gov.in/o/search/v1.0/search", {
      csrf: "guest-test",
    }),
    /endpoint/,
  );
  await assert.rejects(
    fetchCbdtJson(
      "https://www.incometaxindia.gov.in/o/headless-admin-user/v1.0/user-accounts",
      { csrf: "guest-test" },
    ),
    /endpoint/,
  );
});
test("scheduler uses one stable daily bucket with weekly reconciliation on Sunday", () => {
  assert.equal(
    scheduleBucket(new Date("2026-09-27T15:00Z")),
    "weekly:2026-09-27",
  );
  assert.equal(
    scheduleBucket(new Date("2026-09-28T00:00Z")),
    "daily:2026-09-28",
  );
  assert.equal(
    scheduleBucket(new Date("2026-09-28T23:59Z")),
    "daily:2026-09-28",
  );
});

test("weekly scheduling catches up within the same UTC week", () => {
  assert.equal(
    weeklyBucket(new Date("2026-09-27T00:00Z")),
    "weekly:2026-09-27",
  );
  assert.equal(
    weeklyBucket(new Date("2026-10-03T23:59Z")),
    "weekly:2026-09-27",
  );
  assert.equal(
    weeklyBucket(new Date("2026-10-04T00:00Z")),
    "weekly:2026-10-04",
  );
});
