// app/api/chat/route.ts
import { AssistantResponse } from 'ai';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || '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',
});

// ⚠️ PASTE YOUR ASSISTANT ID HERE
const ASSISTANT_ID = 'asst_QtZM3maUaklbOanOBHpwKRFB'; 

export async function POST(req: Request) {
  const input = await req.json();

  // 1. Create a thread if it doesn't exist, or use the existing one
  const threadId = input.threadId ?? (await openai.beta.threads.create({})).id;

  // 2. Add the user's message to the thread
  const createdMessage = await openai.beta.threads.messages.create(threadId, {
    role: 'user',
    content: input.message,
    // Note: This is where we will attach file_ids later if needed
  });

  // 3. Run the Assistant on this thread and stream the results
  return AssistantResponse(
    { threadId, messageId: createdMessage.id },
    async ({ forwardStream, sendDataMessage }) => {
      
      // Run the stream
      const runStream = openai.beta.threads.runs.stream(threadId, {
        assistant_id: ASSISTANT_ID,
      });

      // Forward the stream to the frontend
      let runResult = await forwardStream(runStream);
      
      // (Optional) You can check runResult.status here if needed
    }
  );
}