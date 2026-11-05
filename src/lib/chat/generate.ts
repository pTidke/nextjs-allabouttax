import { createAzureAssistant } from "./model";
import { answerSchema, instructions, validateAnswer } from "./answer";
import type { Evidence } from "../tax/retrieval";

export async function generateAnswer({
  question,
  period,
  history = [],
  evidence,
}: {
  question: string;
  period: string;
  history?: { role: string; content: string }[];
  evidence: Evidence[];
}) {
  if (!evidence.length)
    return {
      ...validateAnswer(
        {
          answer: "No matching evidence",
          supported: false,
          sourceIds: [],
          suggestions: [],
        },
        [],
      ),
      model: null,
    };
  const { client, model } = createAzureAssistant();
  const response = await client.responses.create({
    model,
    store: false,
    max_output_tokens: 2200,
    instructions,
    input: JSON.stringify({
      selectedPeriod: period,
      question: question.trim(),
      history,
      evidence: evidence.map((e, i) => ({
        id: `S${i + 1}`,
        title: e.title,
        passage: e.text,
        anchor: e.anchor,
        period: e.period,
        periodMode: e.periodMode,
        applicabilityNote: e.applicabilityNote,
        entityName: e.entityName,
        investmentFrom: e.investmentFrom,
        investmentThroughInclusive: e.investmentThrough,
        effectiveFrom: e.effectiveFrom,
        effectiveTo: e.effectiveTo,
        documentType: e.documentType,
        legalStatus: e.legalStatus,
      })),
    }),
    text: {
      format: {
        type: "json_schema",
        name: "tax_answer",
        strict: true,
        schema: answerSchema,
      },
    },
  });
  if (response.status !== "completed")
    throw new Error("Incomplete model response.");
  return {
    ...validateAnswer(JSON.parse(response.output_text), evidence),
    model,
  };
}
