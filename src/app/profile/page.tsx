import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { auth } from "@/auth";

export const metadata = {
  title: "Profile",
  robots: { index: false, follow: false },
};

export default async function ProfilePage() {
  const session = await auth();
  if (!session?.user) redirect("/");
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { createdAt: true },
  });
  const rows: [string, string][] = [
    ["Name", session.user.name ?? "—"],
    ["Email", session.user.email ?? "—"],
    [
      "Member since",
      user?.createdAt.toLocaleDateString("en-IN", {
        day: "numeric",
        month: "long",
        year: "numeric",
      }) ?? "—",
    ],
    ["Account", session.user.role === "ADMIN" ? "Administrator" : "Standard"],
  ];
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-6 pb-24 pt-16">
      <h1 className="border-b-[3px] border-double border-ink pb-6 font-serif text-4xl font-bold">
        Your profile
      </h1>
      <dl className="border-2 border-ink bg-paper px-6 py-2">
        {rows.map(([label, value]) => (
          <div
            key={label}
            className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-rule py-4 last:border-b-0"
          >
            <dt className="text-ink-soft">{label}</dt>
            <span
              aria-hidden="true"
              className="min-w-6 flex-1 border-b border-dotted border-faint"
            />
            <dd className="font-medium">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-ink-soft">
        Your name and email come from your Google account.{" "}
        <Link href="/chats">See your chats →</Link>
      </p>
    </main>
  );
}
