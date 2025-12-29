"use client";

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  ReactNode,
} from "react";
import { useAssistant } from "ai/react";
import { Message } from "ai";
import { useSession } from "next-auth/react";

// --- CONSTANTS FOR STORAGE ---
const STORAGE_KEY_MESSAGES = "tax_assistant_messages";
const STORAGE_KEY_THREAD = "tax_assistant_thread_id";

// --- UTILITY: Clean the text before rendering ---
// Keep this if needed elsewhere, or move to utility file. Left here for context.
// Ideally should be imported.

interface ChatContextType {
  status: "in_progress" | "awaiting_message" | null;
  messages: Message[];
  input: string;
  submitMessage: (
    event?: React.FormEvent<HTMLFormElement>,
    requestOptions?: {
      data?: Record<string, string>;
    }
  ) => Promise<void>;
  handleInputChange: (
    event:
      | React.ChangeEvent<HTMLInputElement>
      | React.ChangeEvent<HTMLTextAreaElement>
  ) => void;
  setInput: React.Dispatch<React.SetStateAction<string>>;
  isOpen: boolean;
  setIsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  attachedFile: File | null;
  setAttachedFile: React.Dispatch<React.SetStateAction<File | null>>;
  suggestions: string[];
  setSuggestions: React.Dispatch<React.SetStateAction<string[]>>;
  localThreadId: string;
  user: any; // Using any for session user object flexibility
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  handleSubmit: (e?: React.FormEvent) => Promise<void>;
  clearChat: () => void;
}

const ChatContext = createContext<ChatContextType | undefined>(undefined);

export function ChatProvider({ children }: { children: ReactNode }) {
  const { data: session } = useSession();
  const user = session?.user;

  const {
    status,
    messages,
    input,
    submitMessage,
    handleInputChange,
    setInput,
    setMessages,
    threadId,
  } = useAssistant({
    api: "/api/assistant",
  });

  const [isOpen, setIsOpen] = useState(false);
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [localThreadId, setLocalThreadId] = useState<string>("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // --- 1. LOAD FROM MEMORY ON MOUNT ---
  useEffect(() => {
    const savedMessages = localStorage.getItem(STORAGE_KEY_MESSAGES);
    const savedThreadId = localStorage.getItem(STORAGE_KEY_THREAD);

    if (savedThreadId) {
      setLocalThreadId(savedThreadId);
    }

    if (savedMessages) {
      try {
        const parsed = JSON.parse(savedMessages);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setMessages(parsed as Message[]);
        }
      } catch (e) {
        console.error("Failed to parse chat history:", e);
      }
    }
  }, [setMessages]);

  // --- 2. SAVE TO MEMORY ON CHANGE ---
  useEffect(() => {
    if (messages.length > 0) {
      localStorage.setItem(STORAGE_KEY_MESSAGES, JSON.stringify(messages));
    }
    if (threadId) {
      setLocalThreadId(threadId);
      localStorage.setItem(STORAGE_KEY_THREAD, threadId);
    }
  }, [messages, threadId]);

  // --- EXTRACT SUGGESTIONS LOGIC ---
  useEffect(() => {
    const lastMessage = messages[messages.length - 1];
    if (lastMessage?.role === "assistant") {
      const regex = /<<<SUGGESTIONS=\[(.*?)\]>>>/;
      const match = lastMessage.content.match(regex);
      if (match && match[1]) {
        try {
          const parsed = JSON.parse(`[${match[1]}]`);
          setSuggestions(parsed);
        } catch (e) {
          // ignore parsing errors
        }
      }
    }
  }, [messages]);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() && !attachedFile) return;

    setSuggestions([]);

    await submitMessage(undefined, {
      data: {
        message: input,
        threadId: localThreadId || "",
      },
    });

    setAttachedFile(null);
    if (textareaRef.current) {
      textareaRef.current.style.height = "56px";
    }
  };

  return (
    <ChatContext.Provider
      value={{
        status,
        messages,
        input,
        submitMessage,
        handleInputChange,
        setInput,
        isOpen,
        setIsOpen,
        attachedFile,
        setAttachedFile,
        suggestions,
        setSuggestions,
        localThreadId,
        user,
        textareaRef,
        handleSubmit,
        clearChat: () => {
          setMessages([]);
          setLocalThreadId("");
          setSuggestions([]);
          localStorage.removeItem(STORAGE_KEY_MESSAGES);
          localStorage.removeItem(STORAGE_KEY_THREAD);
        },
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}

export function useChat() {
  const context = useContext(ChatContext);
  if (context === undefined) {
    throw new Error("useChat must be used within a ChatProvider");
  }
  return context;
}
