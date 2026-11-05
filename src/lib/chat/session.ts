import { auth } from "@/auth";
import { HttpError } from "../http";
export async function signedInUserId() {
  const session = await auth();
  if (!session?.user?.id) throw new HttpError(401, "Please sign in first.");
  return session.user.id;
}
