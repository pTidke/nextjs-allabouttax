import { AssistantResponse } from 'ai';
import OpenAI from 'openai';
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || '',
});

// Allow streaming responses up to 30 seconds
export const maxDuration = 30;

export async function POST(req: Request) {
  // 1. Authenticate user and check limits
  const session = await auth();
  if (!session?.user?.email) {
    return new Response(JSON.stringify({ error: "Please log in to ask questions." }), { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
  });

  if (!user) {
    return new Response(JSON.stringify({ error: "User not found." }), { status: 404 });
  }

  const now = new Date();
  const lastQuestion = new Date(user.lastQuestionAt);
  const isNewDay = now.toDateString() !== lastQuestion.toDateString();

  let questionsToday = isNewDay ? 0 : user.questionsToday;

  if (user.role !== 'ADMIN' && questionsToday >= 10) {
    return new Response(JSON.stringify({ 
      error: "You've reached your limit of 10 questions for today. Upgrade Account for unlimited access!" 
    }), { status: 429 });
  }

  // 2. Parse the input
  const input = await req.json();

  // 2. Thread ID Handling
  // Prefer threadId from input, then from user DB record
  let threadId = input.threadId || (input.data && input.data.threadId) || user.threadId;

  if (!threadId || typeof threadId !== 'string' || !threadId.startsWith('thread_')) {
    const thread = await openai.beta.threads.create({});
    threadId = thread.id;
    
    // Save the new threadId to the user record
    await prisma.user.update({
      where: { id: user.id },
      data: { threadId: threadId },
    });
  }

  // 4. Create Message
  const createdMessage = await openai.beta.threads.messages.create(threadId, {
    role: 'user',
    content: input.message ?? input.data?.message,
  });

  // 5. Increment usage count
  await prisma.user.update({
    where: { id: user.id },
    data: {
      questionsToday: questionsToday + 1,
      lastQuestionAt: now,
    },
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