// Liveness only. Database/library details are checked by the private worker CLI.
export async function GET() {
  return Response.json(
    { status: "ok", service: "allabouttax" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
