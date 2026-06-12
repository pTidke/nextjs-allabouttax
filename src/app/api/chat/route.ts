// app/api/chat/route.ts
import { AssistantResponse } from 'ai';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || '',
});

export async function POST(req: Request) {
  const input = (await req.json()) as {
    threadId?: string;
    message: string;
  };

  const assistantId = process.env.ASSISTANT_ID;
  if (!assistantId) {
    return new Response(
      JSON.stringify({ error: "ASSISTANT_ID is not configured." }),
      { status: 500 }
    );
  }

  // 1. Create a thread if it doesn't exist, or use the existing one
  const threadId = input.threadId ?? (await openai.beta.threads.create({})).id;

  // 2. Add the user's message to the thread
  const createdMessage = await openai.beta.threads.messages.create(threadId, {
    role: 'user',
    content: input.message,
  });

  // 3. Run the Assistant on this thread and stream the results
  return AssistantResponse(
    { threadId, messageId: createdMessage.id },
    async ({ forwardStream }) => {
      // Run the stream
      const runStream = openai.beta.threads.runs.stream(threadId, {
        assistant_id: assistantId,
      });

      // Forward the stream to the frontend
      await forwardStream(runStream);
    }
  );
}