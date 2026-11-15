import { prisma } from "../db";
import { HttpError } from "../http";

// EXTRACTION: check that extracted text matches the original document.
// TAX: decide legal applicability and publish to the live library.
// An administrator manages grants; being an administrator grants neither role.
export const REVIEW_ROLES = ["EXTRACTION", "TAX"] as const;
export type ReviewRole = (typeof REVIEW_ROLES)[number];
export type ReviewerAccess = {
  userId: string;
  admin: boolean;
  extraction: boolean;
  tax: boolean;
};

export function isReviewRole(value: unknown): value is ReviewRole {
  return REVIEW_ROLES.includes(value as ReviewRole);
}

// Read fresh from the database on every call, so a revoked grant stops working at
// once, as the admin role already does.
export async function reviewerAccess(userId: string): Promise<ReviewerAccess> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      role: true,
      reviewerGrants: { where: { revokedAt: null }, select: { role: true } },
    },
  });
  const roles = new Set(user?.reviewerGrants.map((grant) => grant.role));
  return {
    userId,
    admin: user?.role === "ADMIN",
    extraction: roles.has("EXTRACTION"),
    tax: roles.has("TAX"),
  };
}

// Anyone who may open the review workspace: a reviewer of either kind, or an
// administrator (who can manage the team and upload, but not decide).
export async function requireReviewer(userId: string, role?: ReviewRole) {
  const access = await reviewerAccess(userId);
  const allowed = role
    ? role === "TAX"
      ? access.tax
      : access.extraction
    : access.admin || access.extraction || access.tax;
  if (!allowed)
    throw new HttpError(
      403,
      role === "TAX"
        ? "Tax review access is required."
        : role === "EXTRACTION"
          ? "Text review access is required."
          : "Review access is required.",
    );
  return access;
}

export async function requireAdmin(userId: string) {
  const access = await reviewerAccess(userId);
  if (!access.admin)
    throw new HttpError(403, "Administrator access is required.");
  return access;
}

// The person must have signed in once, so that an account exists to attach to.
export async function grantRole(
  adminId: string,
  email: string,
  role: ReviewRole,
) {
  await requireAdmin(adminId);
  if (!isReviewRole(role)) throw new HttpError(400, "Unknown review role.");
  const user = await prisma.user.findFirst({
    where: { email: { equals: email.trim(), mode: "insensitive" } },
    select: { id: true },
  });
  if (!user)
    throw new HttpError(
      404,
      "No account uses that email yet. Ask them to sign in once, then try again.",
    );
  return prisma.reviewerGrant.upsert({
    where: { userId_role: { userId: user.id, role } },
    create: { userId: user.id, role, grantedBy: adminId },
    update: { revokedAt: null, grantedBy: adminId, grantedAt: new Date() },
  });
}

export async function revokeRole(
  adminId: string,
  userId: string,
  role: ReviewRole,
) {
  await requireAdmin(adminId);
  if (!isReviewRole(role)) throw new HttpError(400, "Unknown review role.");
  await prisma.reviewerGrant.updateMany({
    where: { userId, role, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function reviewTeam() {
  const grants = await prisma.reviewerGrant.findMany({
    where: { revokedAt: null },
    orderBy: [{ grantedAt: "asc" }],
    select: {
      role: true,
      grantedAt: true,
      user: { select: { id: true, name: true, email: true } },
    },
  });
  const people = new Map<
    string,
    { id: string; name: string | null; email: string; roles: ReviewRole[] }
  >();
  for (const grant of grants) {
    const person = people.get(grant.user.id) ?? { ...grant.user, roles: [] };
    person.roles.push(grant.role as ReviewRole);
    people.set(grant.user.id, person);
  }
  return [...people.values()];
}
