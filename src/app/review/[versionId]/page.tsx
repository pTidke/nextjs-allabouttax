import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { HttpError } from "@/lib/http";
import { reviewDocument } from "@/lib/review/workflow";
import { pageAccess } from "../guard";
import Workspace, { type CarriedHistory } from "./workspace";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Review document",
  robots: { index: false, follow: false },
};

export default async function ReviewDocumentPage({
  params,
}: {
  params: Promise<{ versionId: string }>;
}) {
  await pageAccess();
  const session = await auth();
  const { versionId } = await params;
  let data;
  try {
    data = await reviewDocument(session!.user!.id!, versionId);
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) notFound();
    throw error;
  }
  const { access, version, engine, carriedOver, changedSinceAcceptance } = data;
  return (
    <main className="max-w-7xl mx-auto px-4 md:px-6 py-8 space-y-4">
      <Link href="/review" className="text-sm underline">
        Back to the queue
      </Link>
      <Workspace
        access={{ extraction: access.extraction, tax: access.tax }}
        changedSinceAcceptance={changedSinceAcceptance}
        carriedOver={carriedOver.map((c) => ({
          ...c,
          history: c.history as unknown as CarriedHistory,
          createdAt: c.createdAt.toISOString(),
        }))}
        engine={
          engine && {
            ...engine,
            createdAt: engine.createdAt.toISOString(),
          }
        }
        version={{
          id: version.id,
          hash: version.hash,
          text: version.text,
          status: version.status,
          current: version.current,
          isPdf: version.isPdf,
          fetchedAt: version.fetchedAt.toISOString(),
          reviewNote: version.reviewNote,
          document: {
            title: version.document.title,
            url: version.document.url,
            issuedAt: version.document.issuedAt?.toISOString() ?? null,
            lastError: version.document.lastError,
            uploaded: version.document.source.kind === "UPLOAD",
            sourceName: version.document.source.name,
          },
          chunks: version.chunks,
          sections: version.sections,
          suggestion: version.suggestion,
          draft: version.draft
            ? {
                fields: version.draft.fields as Record<string, string> & {
                  sectionIds?: string[];
                },
                revision: version.draft.revision,
                updatedAt: version.draft.updatedAt.toISOString(),
              }
            : null,
          textChecks: version.textChecks.map((check) => ({
            ...check,
            createdAt: check.createdAt.toISOString(),
          })),
        }}
      />
    </main>
  );
}
