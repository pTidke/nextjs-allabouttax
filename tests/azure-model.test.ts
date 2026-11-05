import assert from "node:assert/strict";
import test from "node:test";
import { createAzureAssistant } from "../src/lib/chat/model";
import { HttpError } from "../src/lib/http";
import { answerSchema } from "../src/lib/chat/answer";

const config = {
  AZURE_OPENAI_BASE_URL:
    "https://pr-allabouttax-resource.openai.azure.com/openai/v1",
  AZURE_OPENAI_DEPLOYMENT: "gpt-5.6-luna",
  AZURE_OPENAI_API_KEY: "test-azure-key",
};

test("Azure SDK request uses the resource v1 endpoint and deployment", async () => {
  let calls = 0;
  const { client, model } = createAzureAssistant(
    config,
    async (input, init) => {
      calls++;
      const request = new Request(input, init);
      assert.equal(request.url, config.AZURE_OPENAI_BASE_URL + "/responses");
      assert.equal(request.method, "POST");
      assert.equal(
        request.headers.get("authorization"),
        "Bearer test-azure-key",
      );
      assert.equal(request.headers.get("openai-organization"), null);
      assert.equal(request.headers.get("openai-project"), null);
      const body = await request.json();
      assert.equal(body.model, config.AZURE_OPENAI_DEPLOYMENT);
      assert.equal(body.store, false);
      assert.deepEqual(body.text.format.schema, answerSchema);
      return Response.json({
        id: "resp_test",
        object: "response",
        status: "completed",
        output: [],
      });
    },
  );
  const response = await client.responses.create({
    model,
    store: false,
    input: "Test input",
    text: {
      format: {
        type: "json_schema",
        name: "tax_answer",
        strict: true,
        schema: answerSchema,
      },
    },
  });
  assert.equal(response.status, "completed");
  assert.equal(calls, 1);
});

test("missing Azure settings never fall back to direct OpenAI credentials", () => {
  for (const key of Object.keys(config)) {
    assert.throws(
      () =>
        createAzureAssistant({
          ...config,
          [key]: "",
          OPENAI_API_KEY: "old-key",
          OPENAI_MODEL: "old-model",
        }),
      (error: unknown) => error instanceof HttpError && error.status === 503,
    );
  }
});

test("incorrect endpoint paths and non-Azure hosts fail before a request", () => {
  for (const endpoint of [
    "https://api.openai.com/v1",
    "https://example.com/openai/v1",
    "http://pr-allabouttax-resource.openai.azure.com/openai/v1",
    "https://pr-allabouttax-resource.services.ai.azure.com/api/projects/pr-allabouttax",
    config.AZURE_OPENAI_BASE_URL + "/responses",
    config.AZURE_OPENAI_BASE_URL + "?api-version=preview",
    "not-a-url",
  ]) {
    assert.throws(
      () =>
        createAzureAssistant({ ...config, AZURE_OPENAI_BASE_URL: endpoint }),
      HttpError,
    );
  }
});
