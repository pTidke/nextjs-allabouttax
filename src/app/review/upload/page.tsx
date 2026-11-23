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
    <main className="mx-auto w-full max-w-2xl space-y-6 px-6 pb-20 pt-10">
      <Link href="/review" className="inline-block text-[15px]">
        ← Back to the queue
      </Link>
      <h1 className="border-b-[3px] border-double border-ink pb-5 font-serif text-4xl font-bold">
        Upload an official PDF
      </h1>
      <p className="text-ink-soft">
        For documents the automatic listings do not cover. The file you upload
        is what gets checked and indexed; the official address is what the
        chatbot will cite. It joins the queue for a text check and tax review
        like any other document.
      </p>
      <UploadForm />
    </main>
  );
}
