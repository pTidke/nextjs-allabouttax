export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function sameOrigin(req: Request) {
  const expected = new URL(process.env.AUTH_URL || req.url).origin;
  if (req.headers.get("origin") !== expected)
    throw new HttpError(403, "Request origin is not permitted.");
}
export async function readJson(
  req: Request,
  max = 16000,
): Promise<Record<string, unknown>> {
  if (!req.headers.get("content-type")?.includes("application/json"))
    throw new HttpError(415, "Expected JSON.");
  const reader = req.body?.getReader();
  if (!reader) throw new HttpError(400, "Request body is required.");
  let size = 0;
  const parts: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > max) throw new HttpError(413, "Request is too large.");
      parts.push(value);
    }
    const result = JSON.parse(Buffer.concat(parts).toString("utf8"));
    if (!result || typeof result !== "object" || Array.isArray(result))
      throw new Error();
    return result;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "Invalid JSON request.");
  } finally {
    await reader.cancel();
  }
}
export function errorResponse(error: unknown) {
  if (error instanceof HttpError)
    return Response.json({ error: error.message }, { status: error.status });
  // Do not log financial text, credentials, or raw provider/database errors.
  console.error("Tax platform request failed", {
    type: error instanceof Error ? error.name : "UnknownError",
  });
  return Response.json(
    {
      error:
        "This request could not be completed. Please try again or contact support.",
    },
    { status: 503 },
  );
}
