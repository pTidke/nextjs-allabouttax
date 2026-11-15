import { signIn } from "@/auth";
import { stagingReviewer } from "@/lib/extraction-staging/principal";
import { stagingRuntime } from "@/lib/extraction-staging/runtime";
import { loadTaxReview } from "@/lib/extraction-staging/tax-review";
import { HttpError } from "@/lib/http";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import TaxReviewPanel from "./panel";

export const metadata: Metadata = {
  title: "Staging tax review",
  robots: { index: false, follow: false },
  alternates: { canonical: null },
};
export const dynamic = "force-dynamic";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ document?: string }>;
}) {
  if (process.env.EXTRACTION_STAGING_ENABLED !== "true") notFound();
  const viewer = await stagingReviewer();
  if (!viewer)
    return (
      <main className="mx-auto max-w-2xl space-y-4 p-8">
        <h1 className="text-2xl font-semibold">Tax review</h1>
        <p>Sign in with the Google account that has staging reviewer access.</p>
        <form
          action={async () => {
            "use server";
            if (process.env.EXTRACTION_STAGING_ENABLED !== "true") notFound();
            await signIn("google", { redirectTo: "/staging/tax-review" });
          }}
        >
          <button className="rounded-lg bg-slate-900 px-4 py-2 text-white">
            Continue with Google
          </button>
        </form>
      </main>
    );
  let data: Awaited<ReturnType<typeof loadTaxReview>>;
  try {
    data = await loadTaxReview(
      stagingRuntime().store,
      viewer,
      (await searchParams).document,
    );
  } catch (error) {
    if (!(error instanceof HttpError) || error.status !== 403) throw error;
    return (
      <main className="mx-auto max-w-2xl space-y-3 p-8">
        <h1 className="text-2xl font-semibold">
          Staging reviewer access required
        </h1>
        <p>
          Use the Google account that was granted access, or ask the staging
          operator to check your access.
        </p>
      </main>
    );
  }
  return (
    <main className="mx-auto max-w-screen-2xl space-y-5 p-4 md:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Tax review</h1>
        <Link href="/staging/extraction" className="text-sm underline">
          Extraction inbox
        </Link>
      </div>
      <p className="text-slate-600">
        Check who the document applies to and when. Reviews stay in staging.
      </p>
      {data.documents.length > 1 && (
        <nav
          aria-label="Documents ready for tax review"
          className="flex flex-wrap gap-3"
        >
          {data.documents.map((doc) => (
            <Link
              key={doc.id}
              aria-current={
                doc.id === data.review?.candidate.id ? "page" : undefined
              }
              className="rounded border px-3 py-2 text-sm aria-[current=page]:bg-slate-100"
              href={"/staging/tax-review?document=" + doc.id}
            >
              {doc.title}
            </Link>
          ))}
        </nav>
      )}
      {data.review ? (
        <TaxReviewPanel
          key={data.review.extractionRevision}
          {...data.review}
          canWrite={data.canWrite}
        />
      ) : (
        <p>
          {data.documents.length
            ? "Choose a document from the list."
            : "No documents are ready for tax review."}
        </p>
      )}
    </main>
  );
}
