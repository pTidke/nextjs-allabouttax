import { auth } from "@/auth";
import { redirect } from "next/navigation";
import HistoryPanel from "./panel";
export const metadata = {
  title: "Your chats",
  robots: { index: false, follow: false },
};
export default async function ChatsPage() {
  if (!(await auth())?.user?.id) redirect("/");
  return <HistoryPanel />;
}
