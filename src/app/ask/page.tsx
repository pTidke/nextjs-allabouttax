import { knowledgeCoverage } from "@/lib/tax/coverage";
import AskPanel from "./panel";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Ask a tax question",
  description:
    "Ask an Indian income-tax question and get an answer from checked official sources.",
};

export default async function AskPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const { q } = await searchParams;
  const question = (Array.isArray(q) ? q[0] : q)?.slice(0, 6000) ?? "";
  const ready = await knowledgeCoverage(null)
    .then((c) => c.availableDocuments)
    .catch(() => null);
  return <AskPanel question={question} ready={ready} />;
}
