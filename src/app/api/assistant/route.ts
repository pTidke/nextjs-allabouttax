import { AssistantResponse } from 'ai';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || '',
});

// Allow streaming responses up to 30 seconds
export const maxDuration = 30;

export async function POST(req: Request) {
  // 1. Parse the input
  const input = await req.json();

  // 2. Thread ID Handling
  let threadId = input.threadId || (input.data && input.data.threadId);
  if (!threadId || typeof threadId !== 'string' || !threadId.startsWith('thread_')) {
    const thread = await openai.beta.threads.create({});
    threadId = thread.id;
  }

  // 3. Create Message
  const createdMessage = await openai.beta.threads.messages.create(threadId, {
    role: 'user',
    content: input.message ?? input.data?.message,
  });

  // 4. Run Assistant
  return AssistantResponse(
    { threadId, messageId: createdMessage.id },
    async ({ forwardStream, sendDataMessage }) => {
      const runStream = openai.beta.threads.runs.stream(threadId, {
        assistant_id: process.env.ASSISTANT_ID ?? (() => {
          throw new Error('ASSISTANT_ID is not set');
        })(),
      });

      let runResult = await forwardStream(runStream);

      while (
        runResult?.status === 'requires_action' &&
        runResult.required_action?.type === 'submit_tool_outputs'
      ) {
        const toolOutputs =
          runResult.required_action.submit_tool_outputs.tool_calls.map(
            (toolCall: any) => {
              const parameters = JSON.parse(toolCall.function.arguments);
              return {
                tool_call_id: toolCall.id,
                output: JSON.stringify({ result: 'Tool execution not implemented yet' }),
              };
            },
          );

        // --- THE FIX IS HERE ---
        // We define a variable typed as 'any' to force TypeScript to accept the arguments
        const submitTools = openai.beta.threads.runs.submitToolOutputsStream as any;

        runResult = await forwardStream(
          submitTools(threadId, runResult.id, { tool_outputs: toolOutputs })
        );
      }
    },
  );
}