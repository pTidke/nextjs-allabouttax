import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { HttpError } from "@/lib/http";
import { requireAdmin, requireReviewer } from "@/lib/review/roles";

// Pages send people without access back to the home page instead of showing an
// error. The API routes check the same roles again on every request.
export async function pageAccess(need: "reviewer" | "admin" = "reviewer") {
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  try {
    return need === "admin"
      ? await requireAdmin(session.user.id)
      : await requireReviewer(session.user.id);
  } catch (error) {
    if (error instanceof HttpError && error.status === 403) redirect("/");
    throw error;
  }
}
