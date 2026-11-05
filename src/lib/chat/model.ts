import OpenAI from "openai";
import { HttpError } from "../http";

export function createAzureAssistant(
  env: Record<string, string | undefined> = process.env,
  fetch?: typeof globalThis.fetch,
) {
  const apiKey = env.AZURE_OPENAI_API_KEY?.trim();
  const model = env.AZURE_OPENAI_DEPLOYMENT?.trim();
  const endpoint = env.AZURE_OPENAI_BASE_URL?.trim();
  const unavailable = () =>
    new HttpError(503, "The assistant is awaiting Azure model configuration.");
  if (!apiKey || !model || !endpoint) throw unavailable();
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw unavailable();
  }
  // Require the Azure resource v1 URL, not a project URL or OpenAI fallback.
  if (
    url.protocol !== "https:" ||
    !/^[a-z0-9-]+\.(openai\.azure\.com|services\.ai\.azure\.com)$/.test(
      url.hostname,
    ) ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    !/^\/openai\/v1\/?$/.test(url.pathname)
  )
    throw unavailable();
  url.pathname = "/openai/v1/";
  return {
    model,
    client: new OpenAI({
      apiKey,
      baseURL: url.toString(),
      organization: null,
      project: null,
      timeout: 40000,
      maxRetries: 0,
      ...(fetch ? { fetch } : {}),
    }),
  };
}
