"use client";

import React, {
  createContext,
  useContext,
  useState,
  useRef,
  useEffect,
  type ReactNode,
} from "react";
import { useSession } from "next-auth/react";
import type { Session } from "next-auth";
import type { Citation } from "@/lib/chat/answer";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  releaseId?: string | null;
  outcome?: string | null;
};
type ChatState = {
  status: "in_progress" | "awaiting_message";
  messages: ChatMessage[];
  input: string;
  setInput: React.Dispatch<React.SetStateAction<string>>;
  suggestions: string[];
  user: Session["user"] | undefined;
  handleSubmit: (event?: React.FormEvent) => Promise<void>;
  // Asks this question now, whatever is in the input.
  ask: (message: string) => Promise<void>;
  clearChat: () => void;
  openConversation: (id: string) => Promise<void>;
  error: string | null;
  // Questions left today, once the server has told us.
  remaining: number | null;
};
const ChatContext = createContext<ChatState | undefined>(undefined);

function ChatStateProvider({
  children,
  user,
}: {
  children: ReactNode;
  user: Session["user"] | undefined;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [status, setStatus] = useState<ChatState["status"]>("awaiting_message");
  const conversationId = useRef<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
      controller.current?.abort();
    },
    [],
  );

  function clearChat() {
    generation.current++;
    controller.current?.abort();
    controller.current = null;
    conversationId.current = null;
    setMessages([]);
    setSuggestions([]);
    setError(null);
    setStatus("awaiting_message");
  }
  async function openConversation(id: string) {
    clearChat();
    const current = generation.current;
    const abort = new AbortController();
    controller.current = abort;
    setStatus("in_progress");
    try {
      const response = await fetch(
        `/api/conversations/${encodeURIComponent(id)}`,
        { cache: "no-store", signal: abort.signal },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      if (current !== generation.current) return;
      conversationId.current = body.id;
      setMessages(body.messages);
      if (body.truncated)
        setError(
          "Showing the latest 100 messages. Download the conversation from Your conversations for the full history.",
        );
    } catch (e) {
      if (!abort.signal.aborted && current === generation.current)
        setError(
          e instanceof Error ? e.message : "Could not load conversation.",
        );
    } finally {
      if (current === generation.current) {
        controller.current = null;
        setStatus("awaiting_message");
      }
    }
  }
  async function handleSubmit(event?: React.FormEvent) {
    event?.preventDefault();
    await ask(input);
  }
  async function ask(text: string) {
    const message = text.trim();
    if (controller.current || !message) return;
    if (!user) {
      setInput(message);
      setError("Please sign in to ask a question.");
      return;
    }
    const current = generation.current;
    const pendingId = crypto.randomUUID();
    const abort = new AbortController();
    controller.current = abort;
    setError(null);
    setSuggestions([]);
    setStatus("in_progress");
    setInput("");
    setMessages((old) => [
      ...old,
      { id: pendingId, role: "user", content: message },
    ]);
    try {
      const response = await fetch("/api/assistant", {
        method: "POST",
        signal: abort.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          ...(conversationId.current
            ? { conversationId: conversationId.current }
            : {}),
        }),
      });
      const payload = await response.json();
      if (response.status === 429) setRemaining(0);
      if (!response.ok)
        throw new Error(
          payload.error || "The assistant is temporarily unavailable.",
        );
      if (current !== generation.current) return;
      conversationId.current = payload.conversationId;
      setMessages((old) => [...old, payload.message]);
      setSuggestions(payload.suggestions || []);
      if (typeof payload.remaining === "number")
        setRemaining(payload.remaining);
    } catch (err) {
      if (current !== generation.current || abort.signal.aborted) return;
      setError(
        err instanceof Error ? err.message : "Unable to send the question.",
      );
      setMessages((old) => old.filter((m) => m.id !== pendingId));
      setInput(message);
    } finally {
      if (current === generation.current) {
        controller.current = null;
        setStatus("awaiting_message");
      }
    }
  }
  return (
    <ChatContext.Provider
      value={{
        status,
        messages,
        input,
        setInput,
        suggestions,
        user,
        handleSubmit,
        ask,
        clearChat,
        openConversation,
        error,
        remaining,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}
export function ChatProvider({ children }: { children: ReactNode }) {
  const { data: session } = useSession();
  // Remount on identity changes. Private chat text is not persisted in localStorage.
  return (
    <ChatStateProvider
      key={session?.user?.id ?? "signed-out"}
      user={session?.user}
    >
      {children}
    </ChatStateProvider>
  );
}
export function useChat() {
  const context = useContext(ChatContext);
  if (!context) throw new Error("useChat must be used within ChatProvider.");
  return context;
}
