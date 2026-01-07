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
const getStorageKeyMessages = (email?: string) =>
  email ? `tax_assistant_messages_${email}` : null;
const getStorageKeyThread = (email?: string) =>
  email ? `tax_assistant_thread_id_${email}` : null;

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
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  handleSubmit: (e?: React.FormEvent) => Promise<void>;
  clearChat: () => void;
  error: Error | undefined;
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
    error,
  } = useAssistant({
    api: "/api/assistant",
  });

  const [isOpen, setIsOpen] = useState(false);
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [localThreadId, setLocalThreadId] = useState<string>("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // --- 1. LOAD FROM MEMORY ON MOUNT AND USER CHANGE ---
  useEffect(() => {
    const email = user?.email;
    if (!email) {
      setMessages([]);
      setLocalThreadId("");
      return;
    }

    const keyMessages = getStorageKeyMessages(email);
    const keyThread = getStorageKeyThread(email);

    const savedMessages = keyMessages
      ? localStorage.getItem(keyMessages)
      : null;
    const savedThreadId = keyThread ? localStorage.getItem(keyThread) : null;

    if (savedThreadId) {
      setLocalThreadId(savedThreadId);
    } else {
      setLocalThreadId("");
    }

    if (savedMessages) {
      try {
        const parsed = JSON.parse(savedMessages);
        if (Array.isArray(parsed)) {
          setMessages(parsed as Message[]);
        } else {
          setMessages([]);
        }
      } catch (e) {
        console.error("Failed to parse chat history:", e);
        setMessages([]);
      }
    } else {
      setMessages([]);
    }
  }, [user?.email, setMessages]);

  // --- 2. SAVE TO MEMORY ON CHANGE ---
  useEffect(() => {
    const email = user?.email;
    if (!email) return;

    const keyMessages = getStorageKeyMessages(email);
    const keyThread = getStorageKeyThread(email);

    if (keyMessages && messages.length > 0) {
      localStorage.setItem(keyMessages, JSON.stringify(messages));
    }
    if (threadId && keyThread) {
      setLocalThreadId(threadId);
      localStorage.setItem(keyThread, threadId);
    }
  }, [messages, threadId, user?.email]);

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
          const email = user?.email;
          if (email) {
            const keyMessages = getStorageKeyMessages(email);
            const keyThread = getStorageKeyThread(email);
            if (keyMessages) localStorage.removeItem(keyMessages);
            if (keyThread) localStorage.removeItem(keyThread);
          }
        },
        error,
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
