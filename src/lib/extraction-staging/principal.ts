import { auth } from "@/auth";
import type { Reviewer } from "./store";

export async function stagingReviewer(): Promise<Reviewer | null> {
  if (process.env.EXTRACTION_STAGING_ENABLED !== "true") return null;
  // Staging only accepts Google sign-in with a verified email. Email is read
  // from the database-backed session; it is never taken from a review request.
  const { user } = (await auth()) ?? {};
  return user?.id ? { id: user.id, email: user.email } : null;
}
