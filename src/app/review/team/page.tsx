import Link from "next/link";
import { reviewTeam } from "@/lib/review/roles";
import { pageAccess } from "../guard";
import TeamActions from "./actions";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Reviewers",
  robots: { index: false, follow: false },
};

export default async function TeamPage() {
  await pageAccess("admin");
  const team = await reviewTeam();
  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 px-6 pb-20 pt-10">
      <Link href="/review" className="inline-block text-[15px]">
        ← Back to the queue
      </Link>
      <h1 className="border-b-[3px] border-double border-ink pb-5 font-serif text-4xl font-bold">
        Reviewers
      </h1>
      <ul className="text-sm text-ink-soft list-disc pl-5 space-y-1">
        <li>
          <strong>Text check</strong>: confirms the extracted text matches the
          original document.
        </li>
        <li>
          <strong>Tax review</strong>: decides what the document means for tax
          and publishes it to the chatbot. Only after a text check has accepted
          it.
        </li>
        <li>
          Being an administrator gives neither. Add yourself here if you review
          too. A person must have signed in once before you can add them.
        </li>
      </ul>
      <TeamActions team={team} />
    </main>
  );
}
