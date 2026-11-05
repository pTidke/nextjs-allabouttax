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
};
type ChatState = {
  status: "in_progress" | "awaiting_message";
  messages: ChatMessage[];
  input: string;
  setInput: React.Dispatch<React.SetStateAction<string>>;
  isOpen: boolean;
  setIsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  period: string;
  changePeriod: (period: string) => void;
  suggestions: string[];
  user: Session["user"] | undefined;
  handleSubmit: (event?: React.FormEvent) => Promise<void>;
  clearChat: () => void;
  openConversation: (id: string) => Promise<void>;
  error: string | null;
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
  const [isOpen, setIsOpen] = useState(false);
  const [period, setPeriod] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
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
    setIsOpen(true);
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
      setPeriod(body.period);
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
    if (controller.current || !input.trim()) return;
    if (!user) {
      setError("Please sign in to ask a question.");
      return;
    }
    if (!period) {
      setError("Choose the tax period before asking your question.");
      return;
    }
    const current = generation.current;
    const message = input.trim();
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
          period,
          ...(conversationId.current
            ? { conversationId: conversationId.current }
            : {}),
        }),
      });
      const payload = await response.json();
      if (!response.ok)
        throw new Error(
          payload.error || "The assistant is temporarily unavailable.",
        );
      if (current !== generation.current) return;
      conversationId.current = payload.conversationId;
      setMessages((old) => [...old, payload.message]);
      setSuggestions(payload.suggestions || []);
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
        isOpen,
        setIsOpen,
        period,
        changePeriod: (next) => {
          clearChat();
          setPeriod(next);
        },
        suggestions,
        user,
        handleSubmit,
        clearChat,
        openConversation,
        error,
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
