"use client";

import React, {
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
  useId,
} from "react";
import { useAssistant } from "ai/react";
import { Message } from "ai"; // Import Message type for type safety
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Dialog,
  DialogContent,
  DialogTrigger,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Send,
  Paperclip,
  Sparkles,
  User,
  FileText,
  X,
  Copy,
  Check,
  Lightbulb,
  Trash2, // Added Trash icon
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

// --- CONSTANTS FOR STORAGE ---
const STORAGE_KEY_MESSAGES = "tax_assistant_messages";
const STORAGE_KEY_THREAD = "tax_assistant_thread_id";

// --- UTILITY: Clean the text before rendering ---
const cleanText = (text: string) => {
  if (!text) return "";
  let cleaned = text.replace(/【.*?】/g, "");
  cleaned = cleaned.replace(/<<<SUGGESTIONS=\[.*?\]>>>/g, "");
  cleaned = cleaned.replace(/<<<SUG.*?$/, "");
  return cleaned.trim();
};

export default function ChatInterface({
  trigger,
}: {
  trigger: React.ReactNode;
}) {
  const {
    status,
    messages,
    input,
    submitMessage,
    handleInputChange,
    setInput,
    setMessages, // Needed to restore history
    threadId, // Needed to save new thread IDs
  } = useAssistant({
    api: "/api/assistant",
  });

  const dialogId = useId();
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [copiedIndex, setCopiedIndex] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [isOpen, setIsOpen] = useState(false);

  // Local state to store the thread ID for API calls
  const [localThreadId, setLocalThreadId] = useState<string>("");

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const defaultSuggestions = [
    "New tax slabs for FY 2025-26?",
    "How to save tax under section 80C?",
    "GST composition scheme rules?",
    "Old vs New Regime calculator",
  ];

  // --- 1. LOAD FROM MEMORY ON MOUNT ---
  useEffect(() => {
    // We only run this on the client side
    const savedMessages = localStorage.getItem(STORAGE_KEY_MESSAGES);
    const savedThreadId = localStorage.getItem(STORAGE_KEY_THREAD);

    if (savedThreadId) {
      setLocalThreadId(savedThreadId);
    }

    if (savedMessages) {
      try {
        const parsed = JSON.parse(savedMessages);
        // Only set if it's a valid array
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
    // Save messages
    if (messages.length > 0) {
      localStorage.setItem(STORAGE_KEY_MESSAGES, JSON.stringify(messages));
    }

    // Save Thread ID (The hook updates 'threadId' after the first message)
    if (threadId) {
      setLocalThreadId(threadId);
      localStorage.setItem(STORAGE_KEY_THREAD, threadId);
    }
  }, [messages, threadId]);

  // --- 3. CLEAR HISTORY FUNCTION ---
  const handleClearChat = () => {
    localStorage.removeItem(STORAGE_KEY_MESSAGES);
    localStorage.removeItem(STORAGE_KEY_THREAD);
    setMessages([]);
    setLocalThreadId("");
    setSuggestions([]);
  };

  // --- TEXTAREA RESIZING LOGIC ---
  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      const newHeight = Math.min(textarea.scrollHeight, 200);
      textarea.style.height = `${newHeight}px`;
      textarea.style.overflowY =
        textarea.scrollHeight > 200 ? "auto" : "hidden";
    }
  }, [input]);

  // --- LOGIC TO SHOW "THINKING" DOTS ---
  const isThinking =
    status === "in_progress" &&
    (messages.length === 0 ||
      messages[messages.length - 1].role === "user" ||
      (messages[messages.length - 1].role === "assistant" &&
        messages[messages.length - 1].content === ""));

  // --- AUTO-SCROLL ---
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, status, isThinking, isOpen]);

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
          // ignore parsing errors while streaming
        }
      }
    }
  }, [messages]);

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(cleanText(text));
    setCopiedIndex(id);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() && !attachedFile) return;

    setSuggestions([]);

    // FIX: Pass threadId inside the 'data' object
    await submitMessage(undefined, {
      data: {
        message: input,
        threadId: localThreadId || "", // Pass it here. TypeScript accepts Record<string, string>
      },
    });

    setAttachedFile(null);
    if (textareaRef.current) {
      textareaRef.current.style.height = "56px";
    }
  };

  // --- MOBILE KEYBOARD FIX ---
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const isDesktop = window.matchMedia("(min-width: 768px)").matches;
    if (e.key === "Enter" && !e.shiftKey) {
      if (isDesktop) {
        e.preventDefault();
        handleSubmit();
      }
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        id={dialogId}
        className="[&>button]:hidden w-full h-[100dvh] md:h-[100dvh] md:max-w-[100dvw] p-0 border-none bg-white shadow-2xl flex flex-col outline-none sm:rounded-[40px] rounded-none"
      >
        {/* HEADER */}
        <div className="p-4 md:p-6 border-b border-slate-50 flex items-center justify-between bg-white z-20 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 md:w-10 md:h-10 rounded-full bg-emerald-50 flex items-center justify-center border border-emerald-100 shadow-sm">
              <Sparkles className="text-emerald-600" size={18} />
            </div>
            <div>
              <DialogTitle className="text-base md:text-lg font-bold text-slate-900 leading-none">
                Indian Tax Assistant
              </DialogTitle>
              <p className="text-[10px] md:text-[11px] text-emerald-600 font-bold uppercase tracking-widest mt-0.5 md:mt-1">
                AI Engine • FY 2025-26
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Clear Chat Button (Only shows if there are messages) */}
            {messages.length > 0 && (
              <button
                onClick={handleClearChat}
                className="w-8 h-8 flex items-center justify-center rounded-full bg-white text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                title="Clear Chat History"
              >
                <Trash2 size={18} />
              </button>
            )}

            <button
              onClick={() => setIsOpen(false)}
              className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 transition-colors"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* CHAT AREA */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto p-4 md:p-10 relative bg-slate-50/20 scroll-smooth"
        >
          <AnimatePresence mode="popLayout">
            {messages.length === 0 ? (
              // INTRO VIEW
              <motion.div
                key="intro"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="h-full flex flex-col items-center justify-center text-center max-w-2xl mx-auto px-4"
              >
                <div className="flex-1 flex flex-col items-center justify-center space-y-6">
                  <div className="w-16 h-16 md:w-20 md:h-20 rounded-full bg-blue-50 flex items-center justify-center border border-blue-100 mx-auto shadow-sm">
                    <Sparkles className="text-blue-600" size={32} />
                  </div>
                  <div className="space-y-2">
                    <h2 className="text-xl md:text-2xl font-bold text-slate-900">
                      Namaste! I'm your Indian Tax Assistant
                    </h2>
                    <p className="text-slate-500 text-sm max-w-xs md:max-w-md mx-auto leading-relaxed">
                      I specialize in Indian taxation laws. Ask me about ITR
                      filing, GST compliance, New Tax Regime vs Old, or any
                      other tax-related queries.
                    </p>
                  </div>
                </div>

                {/* SUGGESTIONS GRID */}
                <div className="w-full pb-8 pt-4">
                  <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mb-4">
                    Suggested Questions
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 w-full max-w-xl mx-auto">
                    {defaultSuggestions.map((text, i) => (
                      <button
                        key={i}
                        onClick={() => {
                          setInput(text);
                          if (textareaRef.current) textareaRef.current.focus();
                        }}
                        className="py-3 px-5 bg-white border border-slate-100 rounded-xl text-slate-600 text-sm hover:border-emerald-500 hover:text-emerald-700 transition-all text-left shadow-sm hover:shadow-md flex items-center gap-3"
                      >
                        <Lightbulb
                          size={16}
                          className="text-emerald-500 shrink-0"
                        />
                        {text}
                      </button>
                    ))}
                  </div>
                </div>
              </motion.div>
            ) : (
              // MESSAGES LIST
              <div className="space-y-6 md:space-y-8 pb-4">
                {messages.map((msg) => (
                  <motion.div
                    key={msg.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`flex ${
                      msg.role === "user" ? "justify-end" : "justify-start"
                    }`}
                  >
                    <div
                      className={`max-w-[95%] md:max-w-[85%] flex gap-2 md:gap-4 ${
                        msg.role === "user" ? "flex-row-reverse" : "flex-row"
                      }`}
                    >
                      <div
                        className={`w-8 h-8 md:w-9 md:h-9 rounded-full flex items-center justify-center flex-shrink-0 shadow-sm ${
                          msg.role === "user"
                            ? "bg-slate-900 text-white hidden md:flex"
                            : "bg-white border border-emerald-100"
                        }`}
                      >
                        {msg.role === "user" ? (
                          <User size={14} />
                        ) : (
                          <Sparkles className="text-emerald-600" size={14} />
                        )}
                      </div>

                      <div className="group relative space-y-2 max-w-full">
                        <div
                          className={`p-4 md:p-5 rounded-2xl md:rounded-[28px] text-sm md:text-base leading-relaxed shadow-sm transition-all ${
                            msg.role === "user"
                              ? "bg-slate-900 text-white rounded-tr-none"
                              : "bg-white text-slate-700 border border-slate-100 rounded-tl-none"
                          }`}
                        >
                          {msg.role === "user" ? (
                            msg.content
                          ) : (
                            <div className="prose prose-sm max-w-none">
                              <ReactMarkdown
                                remarkPlugins={[remarkGfm]}
                                components={{
                                  table: ({ node, ...props }) => (
                                    <div className="overflow-x-auto my-2 md:my-4 rounded-lg border border-slate-200 shadow-sm">
                                      <table
                                        className="w-full text-xs md:text-sm text-left text-slate-600 min-w-[300px]"
                                        {...props}
                                      />
                                    </div>
                                  ),
                                  thead: ({ node, ...props }) => (
                                    <thead
                                      className="text-xs text-slate-700 uppercase bg-slate-50/50 border-b border-slate-100"
                                      {...props}
                                    />
                                  ),
                                  th: ({ node, ...props }) => (
                                    <th
                                      className="px-3 py-2 md:px-6 md:py-4 font-semibold tracking-wider"
                                      {...props}
                                    />
                                  ),
                                  td: ({ node, ...props }) => (
                                    <td
                                      className="px-3 py-2 md:px-6 md:py-4 border-b border-slate-50 last:border-0"
                                      {...props}
                                    />
                                  ),
                                  tr: ({ node, ...props }) => (
                                    <tr
                                      className="bg-white hover:bg-slate-50/50 transition-colors"
                                      {...props}
                                    />
                                  ),
                                  ul: ({ node, ...props }) => (
                                    <ul
                                      className="list-disc pl-4 md:pl-5 space-y-1 md:space-y-2 my-2 marker:text-emerald-500"
                                      {...props}
                                    />
                                  ),
                                  ol: ({ node, ...props }) => (
                                    <ol
                                      className="list-decimal pl-4 md:pl-5 space-y-1 md:space-y-2 my-2 marker:text-emerald-500 font-medium"
                                      {...props}
                                    />
                                  ),
                                  strong: ({ node, ...props }) => (
                                    <strong
                                      className="font-bold text-slate-900"
                                      {...props}
                                    />
                                  ),
                                  a: ({ node, ...props }) => (
                                    <a
                                      className="text-emerald-600 underline underline-offset-4 hover:text-emerald-700 font-medium"
                                      {...props}
                                    />
                                  ),
                                }}
                              >
                                {cleanText(msg.content)}
                              </ReactMarkdown>
                            </div>
                          )}
                          {msg.role === "assistant" && (
                            <button
                              onClick={() => handleCopy(msg.content, msg.id)}
                              className="absolute -right-8 top-0 p-2 md:opacity-0 md:group-hover:opacity-100 opacity-100 text-slate-400"
                            >
                              {copiedIndex === msg.id ? (
                                <Check size={14} className="text-emerald-500" />
                              ) : (
                                <Copy size={14} />
                              )}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </motion.div>
                ))}

                {/* ANIMATED DOTS */}
                {isThinking && (
                  <motion.div
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex justify-start"
                  >
                    <div className="flex gap-2 md:gap-4 items-center">
                      <div className="w-8 h-8 md:w-9 md:h-9 rounded-full bg-white border border-emerald-100 flex items-center justify-center shadow-sm">
                        <Sparkles
                          className="text-emerald-600 animate-pulse"
                          size={14}
                        />
                      </div>
                      <div className="bg-white border border-slate-100 p-3 px-5 md:p-4 md:px-6 rounded-2xl md:rounded-[24px] rounded-tl-none flex items-center gap-1.5 shadow-sm">
                        {[0, 0.2, 0.4].map((delay) => (
                          <motion.span
                            key={delay}
                            animate={{
                              scale: [1, 1.2, 1],
                              opacity: [0.4, 1, 0.4],
                            }}
                            transition={{
                              repeat: Infinity,
                              duration: 1,
                              delay,
                            }}
                            className="w-1.5 h-1.5 bg-emerald-500 rounded-full"
                          />
                        ))}
                      </div>
                    </div>
                  </motion.div>
                )}

                {/* DYNAMIC SUGGESTIONS */}
                {!isThinking &&
                  status !== "in_progress" &&
                  suggestions.length > 0 && (
                    <div className="md:ml-14 flex flex-wrap gap-2 animate-in fade-in slide-in-from-bottom-2">
                      {suggestions.map((sug, i) => (
                        <button
                          key={i}
                          onClick={() => {
                            setInput(sug);
                            if (textareaRef.current)
                              textareaRef.current.focus();
                          }}
                          className="px-3 py-1.5 md:px-4 md:py-2 bg-white border border-emerald-100 text-emerald-700 text-[10px] md:text-xs rounded-full hover:bg-emerald-50 transition-colors shadow-sm"
                        >
                          {sug}
                        </button>
                      ))}
                    </div>
                  )}
              </div>
            )}
          </AnimatePresence>
        </div>

        {/* INPUT AREA */}
        <div className="p-3 md:p-8 bg-white border-t border-slate-100 relative shrink-0 z-30">
          <AnimatePresence>
            {attachedFile && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                className="absolute -top-14 md:-top-16 left-4 md:left-8 flex items-center gap-3 bg-white border border-emerald-100 p-2 pr-4 rounded-xl md:rounded-2xl shadow-xl z-20"
              >
                <div className="w-8 h-8 md:w-10 md:h-10 bg-emerald-50 rounded-lg md:rounded-xl flex items-center justify-center text-emerald-600">
                  <FileText size={18} />
                </div>
                <div className="flex flex-col">
                  <span className="text-[10px] md:text-xs font-bold text-slate-700 truncate max-w-[120px] md:max-w-[150px]">
                    {attachedFile.name}
                  </span>
                  <span className="text-[9px] md:text-[10px] text-slate-400">
                    {(attachedFile.size / 1024).toFixed(1)} KB
                  </span>
                </div>
                <button
                  onClick={() => setAttachedFile(null)}
                  className="ml-2 p-1 hover:text-red-500 text-slate-300 transition-colors"
                >
                  <X size={14} />
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="max-w-4xl mx-auto">
            <div className="flex items-end gap-2 md:gap-4">
              <div className="mb-1 md:mb-1.5">
                <input
                  type="file"
                  ref={fileInputRef}
                  className="hidden"
                  onChange={(e) => {
                    setAttachedFile(e.target.files?.[0] || null);
                    e.target.value = "";
                  }}
                />
                <Button
                  onClick={() => fileInputRef.current?.click()}
                  variant="outline"
                  size="icon"
                  className="rounded-full w-10 h-10 md:w-12 md:h-12 border-slate-200 text-slate-400 hover:text-emerald-600 transition-colors shadow-sm"
                >
                  <Paperclip size={20} />
                </Button>
              </div>

              <div className="flex-1 relative group">
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={handleInputChange}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask me..."
                  rows={1}
                  className="w-full min-h-[48px] md:min-h-[56px] py-2 pl-4 md:py-4 md:pl-6 pr-12 md:pr-16 rounded-[24px] md:rounded-[28px] border border-slate-200 bg-slate-50/50 focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all text-base md:text-sm resize-none overflow-hidden outline-none block leading-relaxed"
                />
                <Button
                  onClick={() => handleSubmit()}
                  disabled={
                    status === "in_progress" || (!input.trim() && !attachedFile)
                  }
                  size="icon"
                  className="absolute right-1.5 bottom-1.5 md:right-2 md:bottom-2 h-9 w-9 md:h-9 md:w-9 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg shadow-emerald-600/20 disabled:opacity-50 transition-all"
                >
                  <Send size={16} />
                </Button>
              </div>
            </div>
            <p className="text-center text-[8px] text-slate-400 mt-3 md:mt-5 uppercase tracking-[0.25em] font-bold">
              AI can make mistakes. Verify info.
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
