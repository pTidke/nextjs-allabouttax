import { notFound, redirect } from "next/navigation";
import { stagingRuntime } from "@/lib/extraction-staging/runtime";
import ExtractionPanel from "./panel";
import { HttpError } from "@/lib/http";
import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "Extraction review",
  robots: { index: false, follow: false },
  alternates: { canonical: null },
};
export const dynamic = "force-dynamic";
export default async function Page() {
  if (process.env.EXTRACTION_STAGING_ENABLED !== "true") notFound();
  const { auth } = await import("@/auth"),
    session = await auth();
  if (!session?.user?.id) redirect("/");
  try {
    await stagingRuntime().store.list(session.user.id);
  } catch (error) {
    if (!(error instanceof HttpError) || error.status !== 403) throw error;
    return (
      <main className="mx-auto max-w-2xl p-10">
        <h1 className="text-2xl font-semibold">Reviewer access is required</h1>
        <p className="mt-3">
          Your account is signed in. An operator must grant extraction reviewer
          access for this staging environment.
        </p>
      </main>
    );
  }
  return <ExtractionPanel viewerId={session.user.id} />;
}
