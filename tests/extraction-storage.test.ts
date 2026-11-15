import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { Readable } from "node:stream";
import {
  S3Client,
  GetObjectCommand,
  GetBucketAclCommand,
  GetBucketPolicyCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import {
  evidenceConfig,
  stagingConfig,
} from "../src/lib/extraction-staging/config";
import {
  NeonEvidence,
  neonClient,
  type NeonConfig,
} from "../src/lib/extraction-staging/neon-storage";
import {
  checkedStream,
  REMOTE_OBJECT_LIMIT,
} from "../src/lib/extraction-staging/object-stream";
import { uploadCandidates } from "../src/lib/extraction-staging/upload";
import { inventory } from "../src/lib/extraction-staging/bundle-plan";
import type {
  Candidate,
  ObjectRef,
} from "../src/lib/extraction-staging/contract";
const hash = (s: string | Buffer) =>
  createHash("sha256").update(s).digest("hex");
const reference = (s: string): ObjectRef => ({
  object_id: "o-" + hash(s),
  sha256: hash(s),
});
const env: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  EXTRACTION_STAGING_OBJECT_BACKEND: "neon-s3",
  EXTRACTION_STAGING_BRANCH_ID: "br-staging-test",
  EXTRACTION_STAGING_S3_ENDPOINT:
    "https://br-staging-test.storage.c-2.us-east-2.aws.neon.tech",
  EXTRACTION_STAGING_S3_REGION: "us-east-2",
  EXTRACTION_STAGING_S3_BUCKET: "private-staging",
  EXTRACTION_STAGING_S3_ACCESS_KEY_ID: "synthetic-read-only-key",
  EXTRACTION_STAGING_S3_SECRET_ACCESS_KEY: "synthetic-secret",
};
const config = evidenceConfig(env, "test-extraction") as NeonConfig;
function stream(bytes: Uint8Array) {
  return new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(bytes);
      c.close();
    },
  });
}
function named(name: string) {
  const error = new Error("Synthetic provider failure");
  error.name = name;
  return error;
}
function fake() {
  const objects = new Map<string, Buffer>(),
    calls: string[] = [];
  const state = {
    public: false,
    policy: false,
    range: false,
    status: 200,
    failAfterPut: false,
  };
  const client = {
    send: async (command: { input: Record<string, unknown> }) => {
      calls.push(command.constructor.name);
      if (command instanceof GetBucketAclCommand)
        return {
          Owner: { ID: "owner" },
          Grants: [
            {
              Grantee: { Type: "CanonicalUser", ID: "owner" },
              Permission: "FULL_CONTROL",
            },
            ...(state.public
              ? [
                  {
                    Grantee: {
                      Type: "Group",
                      URI: "http://acs.amazonaws.com/groups/global/AllUsers",
                    },
                    Permission: "READ",
                  },
                ]
              : []),
          ],
        };
      if (command instanceof GetBucketPolicyCommand) {
        if (state.policy)
          return {
            Policy: JSON.stringify({
              Statement: [{ Effect: "Allow", Principal: "*" }],
            }),
          };
        throw named("NoSuchBucketPolicy");
      }
      if (command instanceof GetObjectCommand) {
        const value = objects.get(String(command.input.Key));
        if (!value) throw named("NoSuchKey");
        return {
          $metadata: { httpStatusCode: state.status },
          ContentLength: value.length,
          ...(state.range ? { ContentRange: "bytes 0-1/50" } : {}),
          Body: { transformToWebStream: () => stream(value) },
        };
      }
      if (command instanceof PutObjectCommand) {
        assert.equal(command.input.IfNoneMatch, "*");
        assert.equal(command.input.CacheControl, "private, no-store");
        const key = String(command.input.Key);
        if (objects.has(key)) throw named("PreconditionFailed");
        objects.set(key, Buffer.from(command.input.Body as Uint8Array));
        if (state.failAfterPut) {
          state.failAfterPut = false;
          throw named("ConnectionInterrupted");
        }
        return {};
      }
      throw Error("Unexpected provider operation");
    },
  } as unknown as Pick<S3Client, "send">;
  return {
    client,
    state,
    calls,
    objects,
    reader: new NeonEvidence(config, client),
  };
}
function fixture() {
  const source = "public source",
    render = "page render",
    revision = "extraction revision";
  const refs = [source, render, revision].map(reference);
  const bytes = new Map(
    [source, render, revision].map((s) => [hash(s), Buffer.from(s)]),
  );
  const c: Candidate = {
    id: hash("candidate"),
    sourceId: "public-fixture",
    sourceHash: refs[0].sha256,
    runId: "run-1",
    revisionHash: refs[2].sha256,
    title: "Public engineering source",
    officialUrl: "https://www.incometax.gov.in/source",
    scopeNote: "A bounded source page",
    kind: "native_full_pages",
    state: "AWAITING_EXTRACTION_REVIEW",
    blockingHolds: [],
    reviewHolds: [],
    original: refs[0],
    evidence: refs,
    renders: [{ page: 1, width: 600, height: 800, object: refs[1] }],
    regions: [
      {
        id: "p1-b1",
        page: 1,
        raw: "text",
        proposed: "text",
        state: "transcribed",
        note: "",
        box: { x0: 10, x1: 50, top: 10, bottom: 50 },
      },
    ],
  };
  return { c, bytes, read: async (r: ObjectRef) => bytes.get(r.sha256)! };
}
test("cloud configuration pins HTTPS origin, branch, region, namespace and explicit credentials", () => {
  assert.equal(config.prefix, "extraction/test-extraction/objects/");
  for (const change of [
    { EXTRACTION_STAGING_S3_ENDPOINT: "http://127.0.0.1:8000" },
    {
      EXTRACTION_STAGING_S3_ENDPOINT:
        "https://br-production.storage.c-2.us-east-2.aws.neon.tech",
    },
    {
      EXTRACTION_STAGING_S3_ENDPOINT:
        env.EXTRACTION_STAGING_S3_ENDPOINT + "/foreign",
    },
    {
      EXTRACTION_STAGING_S3_ENDPOINT:
        env.EXTRACTION_STAGING_S3_ENDPOINT + "?redirect=https://example.com",
    },
    {
      EXTRACTION_STAGING_S3_ENDPOINT:
        "https://br-staging-test.storage.c-2.us-east-2.aws.neon.tech.example.com",
    },
    { EXTRACTION_STAGING_S3_REGION: "eu-central-1" },
    { EXTRACTION_STAGING_S3_BUCKET: "../private" },
    { EXTRACTION_STAGING_S3_ACCESS_KEY_ID: "" },
    { EXTRACTION_STAGING_OBJECT_BACKEND: "auto" },
  ])
    assert.throws(() =>
      evidenceConfig({ ...env, ...change }, "test-extraction"),
    );
  assert.throws(() => evidenceConfig(env, "../escape"));
  assert.throws(
    () =>
      evidenceConfig(
        {
          NODE_ENV: "test",
          VERCEL: "1",
          EXTRACTION_STAGING_OBJECT_ROOT: "/tmp/ephemeral",
        },
        "test-extraction",
      ),
    /not durable/,
  );
  const stage = stagingConfig({
    ...env,
    EXTRACTION_STAGING_ENABLED: "true",
    EXTRACTION_STAGING_ENVIRONMENT_ID: "test-extraction",
    DATABASE_URL: "postgresql://live@live.example/db",
    EXTRACTION_STAGING_DATABASE_URL: "postgresql://stage@stage.example/db",
    EXTRACTION_STAGING_LIVE_DATABASE_IDENTITY:
      "postgresql://production.example/db",
  });
  assert.equal(stage?.objects.kind, "neon-s3");
  const configured = {
    ...env,
    EXTRACTION_STAGING_ENABLED: "true",
    EXTRACTION_STAGING_ENVIRONMENT_ID: "test-extraction",
    DATABASE_URL: "postgresql://auth@stage.example/auth",
    EXTRACTION_STAGING_DATABASE_URL:
      "postgresql://review@stage.example/reviews",
    EXTRACTION_STAGING_LIVE_DATABASE_IDENTITY:
      "postgresql://production.example/db",
  };
  assert.throws(
    () =>
      stagingConfig({
        ...configured,
        EXTRACTION_STAGING_LIVE_DATABASE_IDENTITY: undefined,
      }),
    /Pin the actual/,
  );
  assert.throws(
    () =>
      stagingConfig({
        ...configured,
        DATABASE_URL: "postgresql://auth@production.example/db",
      }),
    /both be isolated/,
  );
  assert.throws(
    () =>
      stagingConfig({
        ...configured,
        EXTRACTION_STAGING_DATABASE_URL:
          "postgresql://review@production-pooler.example/db",
      }),
    /both be isolated/,
  );
});
test("remote reads require private ACL/policy and use only digest-based object keys", async () => {
  const f = fake(),
    ref = reference("bytes");
  f.objects.set(f.reader.key(ref), Buffer.from("bytes"));
  assert.equal((await f.reader.read(ref)).toString(), "bytes");
  assert.deepEqual(f.calls, [
    "GetBucketAclCommand",
    "GetBucketPolicyCommand",
    "GetObjectCommand",
  ]);
  f.state.public = true;
  await assert.rejects(f.reader.read(ref), /not verified private/);
  f.state.public = false;
  f.state.policy = true;
  await assert.rejects(f.reader.read(ref), /operator review/);
  const count = f.calls.length;
  await assert.rejects(
    f.reader.read({ ...ref, object_id: "../../private" }),
    /Invalid object/,
  );
  assert.equal(f.calls.length, count);
  assert.ok(!f.calls.includes("PutObjectCommand"));
});
test("remote evidence substitutions, partial responses and missing objects cannot satisfy review", async () => {
  const f = fake(),
    { c, bytes } = fixture();
  for (const [sha, data] of bytes)
    f.objects.set(config.prefix + sha + ".blob", data);
  await f.reader.verify(c);
  const key = f.reader.key(c.original);
  f.objects.set(key, Buffer.from("changed"));
  await assert.rejects(f.reader.verify(c), /changed or is incomplete/);
  f.objects.set(key, bytes.get(c.sourceHash)!);
  f.state.range = true;
  await assert.rejects(f.reader.verify(c), /Complete source/);
  f.state.range = false;
  f.state.status = 206;
  await assert.rejects(f.reader.read(c.original), /Complete source/);
  f.state.status = 200;
  f.objects.delete(key);
  await assert.rejects(f.reader.verify(c), { name: "NoSuchKey" });
});
test("the real SDK signs path-style requests only to the pinned Neon endpoint", async () => {
  const ref = reference("abc"),
    requests: {
      hostname: string;
      path: string;
      headers: Record<string, string>;
    }[] = [];
  const client = neonClient(config, {
    handle: async (request: {
      hostname: string;
      path: string;
      headers: Record<string, string>;
    }) => {
      requests.push(request);
      return {
        response: {
          statusCode: 200,
          headers: {
            "content-length": "3",
            "content-type": "application/octet-stream",
          },
          body: Readable.from([Buffer.from("abc")]),
        },
      };
    },
  });
  try {
    const reader = new NeonEvidence(config, client);
    assert.equal(
      (await reader.raw(ref, AbortSignal.timeout(1000))).toString(),
      "abc",
    );
    assert.equal(requests[0].hostname, new URL(config.endpoint).hostname);
    assert.equal(
      requests[0].path,
      "/" + config.bucket + "/" + config.prefix + ref.sha256 + ".blob",
    );
    assert.match(
      requests[0].headers.authorization,
      /Credential=synthetic-read-only-key\//,
    );
    assert.ok(!JSON.stringify(requests).includes(config.secretAccessKey));
  } finally {
    client.destroy();
  }
});
test("stream verification enforces declared length, actual byte budget, hashes and cancellation", async () => {
  const ref = reference("abc"),
    bytes = Buffer.from("abc");
  assert.deepEqual(
    await checkedStream(
      ref,
      stream(bytes),
      undefined,
      AbortSignal.timeout(1000),
    ),
    bytes,
  );
  await assert.rejects(
    checkedStream(ref, stream(bytes), 10, AbortSignal.timeout(1000)),
    /incomplete/,
  );
  await assert.rejects(
    checkedStream(ref, stream(bytes), 3, AbortSignal.timeout(1000), 2),
    /budget/,
  );
  await assert.rejects(
    checkedStream(ref, stream(bytes), undefined, AbortSignal.timeout(1000), 2),
    /budget/,
  );
  let cancelled = false;
  const hanging = new ReadableStream<Uint8Array>({
    cancel() {
      cancelled = true;
    },
  });
  await assert.rejects(
    checkedStream(ref, hanging, undefined, AbortSignal.timeout(10)),
    { name: "TimeoutError" },
  );
  assert.equal(cancelled, true);
  const stuckCancellation = new ReadableStream<Uint8Array>({
    cancel() {
      return new Promise<void>(() => {});
    },
  });
  await assert.rejects(
    checkedStream(ref, stuckCancellation, undefined, AbortSignal.timeout(10)),
    { name: "TimeoutError" },
  );
});
test("transfer planning deduplicates evidence and rejects budget violations before any upload", async () => {
  const { c, read } = fixture();
  const plan = await inventory([c, { ...c, id: hash("other") }], read);
  assert.equal(plan.objects.length, 3);
  assert.equal(plan.taxApproved, false);
  assert.equal(plan.retrievalItemsCreated, 0);
  const f = fake();
  await assert.rejects(
    uploadCandidates(config, [c], read, 1, f.client),
    /budget/,
  );
  assert.equal(f.calls.length, 0);
  await assert.rejects(
    inventory([c], async () => Buffer.from("corrupted")),
    /changed/,
  );
  const big = Buffer.alloc(REMOTE_OBJECT_LIMIT + 1),
    bigRef = { object_id: "large", sha256: hash(big) };
  await assert.rejects(
    inventory([{ ...c, evidence: [...c.evidence, bigRef] }], async (r) =>
      r.object_id === "large" ? big : read(r),
    ),
    /delivery limit/,
  );
});
test("operator uploads verify remote bytes, resume interrupted writes and never overwrite corrupt evidence", async () => {
  const f = fake(),
    { c, read } = fixture();
  f.state.failAfterPut = true;
  await assert.rejects(
    uploadCandidates(config, [c], read, undefined, f.client),
    { name: "ConnectionInterrupted" },
  );
  assert.equal(f.objects.size, 1);
  const resumed = await uploadCandidates(
    config,
    [c],
    read,
    undefined,
    f.client,
  );
  assert.equal(resumed.uploaded, 2);
  assert.equal(resumed.reused, 1);
  assert.equal(resumed.publicationEligible, false);
  const putCount = f.calls.filter((c) => c === "PutObjectCommand").length;
  const repeated = await uploadCandidates(
    config,
    [c],
    read,
    undefined,
    f.client,
  );
  assert.equal(repeated.uploaded, 0);
  assert.equal(repeated.reused, 3);
  assert.equal(
    f.calls.filter((c) => c === "PutObjectCommand").length,
    putCount,
  );
  f.objects.set(f.reader.key(c.original), Buffer.from("bad replacement"));
  await assert.rejects(
    uploadCandidates(config, [c], read, undefined, f.client),
    /changed or is incomplete/,
  );
  assert.equal(
    f.calls.filter((c) => c === "PutObjectCommand").length,
    putCount,
  );
});
