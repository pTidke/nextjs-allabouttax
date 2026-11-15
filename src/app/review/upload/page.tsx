import Link from "next/link";
import { redirect } from "next/navigation";
import { pageAccess } from "../guard";
import UploadForm from "./form";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Upload a document",
  robots: { index: false, follow: false },
};

export default async function UploadPage() {
  const access = await pageAccess();
  if (!access.admin && !access.extraction) redirect("/review");
  return (
    <main className="max-w-2xl mx-auto px-6 py-10 space-y-6">
      <Link href="/review" className="text-sm underline">
        Back to the queue
      </Link>
      <h1 className="text-3xl font-semibold">Upload an official PDF</h1>
      <p className="text-slate-600">
        For documents the automatic listings do not cover. The file you upload
        is what gets checked and indexed; the official address is what the
        chatbot will cite. It joins the queue for a text check and tax review
        like any other document.
      </p>
      <UploadForm />
    </main>
  );
}
