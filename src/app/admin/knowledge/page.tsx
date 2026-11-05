import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { redirect } from "next/navigation";
import KnowledgeAdmin from "./panel";

export const dynamic = "force-dynamic";
export default async function Page() {
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (user?.role !== "ADMIN") redirect("/");
  return <KnowledgeAdmin />;
}
