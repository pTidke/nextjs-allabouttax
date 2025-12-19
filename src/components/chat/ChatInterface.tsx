"use client";

import React, { useState, useRef, useEffect } from "react";
import { useAssistant } from "ai/react";
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
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

// --- UTILITY: Clean the text before rendering ---
const cleanText = (text: string) => {
  if (!text) return "";
  let cleaned = text.replace(/【.*?】/g, ""); // Remove OpenAI citations
  cleaned = cleaned.replace(/<<<SUGGESTIONS=\[.*?\]>>>/g, ""); // Remove suggestions JSON
  cleaned = cleaned.replace(/<<<SUG.*?$/, ""); // Remove partial stream
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
  } = useAssistant({
    api: "/api/assistant",
  });

  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [copiedIndex, setCopiedIndex] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const defaultSuggestions = [
    "New tax slabs for FY 2025-26?",
    "How to save tax under section 80C?",
    "Explain GST for freelancers",
    "Old vs New Regime comparison",
  ];

  // --- 1. Logic to show "Thinking" dots ---
  const isThinking =
    status === "in_progress" &&
    (messages.length === 0 ||
      messages[messages.length - 1].role === "user" ||
      (messages[messages.length - 1].role === "assistant" &&
        messages[messages.length - 1].content === ""));

  // --- 2. Auto-Scroll ---
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, status, isThinking]);

  // --- 3. Extract Suggestions Logic ---
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

    await submitMessage(undefined, {
      data: { message: input },
    });

    setAttachedFile(null);
    if (textareaRef.current) textareaRef.current.style.height = "56px";
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <Dialog>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-[92vw] w-full h-[90vh] p-0 overflow-hidden border-none rounded-[40px] bg-white shadow-2xl flex flex-col outline-none">
        {/* HEADER */}
        <div className="p-6 border-b border-slate-50 flex items-center justify-between bg-white z-20">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-emerald-50 flex items-center justify-center border border-emerald-100 shadow-sm">
              <Sparkles className="text-emerald-600" size={20} />
            </div>
            <div>
              <DialogTitle className="text-lg font-bold text-slate-900 leading-none">
                Indian Tax Assistant
              </DialogTitle>
              <p className="text-[11px] text-emerald-600 font-bold uppercase tracking-widest mt-1">
                AI Engine • FY 2025-26
              </p>
            </div>
          </div>
        </div>

        {/* CHAT AREA */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto p-6 md:p-10 relative bg-slate-50/20 scroll-smooth"
        >
          <AnimatePresence mode="popLayout">
            {messages.length === 0 ? (
              // INTRO VIEW
              <motion.div
                key="intro"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="h-full flex flex-col items-center justify-center text-center max-w-2xl mx-auto space-y-8"
              >
                <div className="space-y-6">
                  <div className="w-16 h-16 rounded-full bg-blue-50 flex items-center justify-center border border-blue-100 mx-auto shadow-sm">
                    <Sparkles className="text-blue-600" size={32} />
                  </div>
                  <h2 className="text-xl md:text-2xl font-bold text-slate-900">
                    Namaste! I'm your Indian Tax Assistant
                  </h2>
                  <p className="text-slate-500 text-sm max-w-lg mx-auto leading-relaxed">
                    How can I help you with your taxes today?
                  </p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 w-full max-w-xl">
                  {defaultSuggestions.map((text, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        setInput(text);
                        if (textareaRef.current) textareaRef.current.focus();
                      }}
                      className="py-2 px-4 bg-white border border-slate-100 rounded-2xl text-slate-600 text-sm hover:border-emerald-500 hover:text-emerald-700 transition-all text-left shadow-sm hover:shadow-md"
                    >
                      {text}
                    </button>
                  ))}
                </div>
              </motion.div>
            ) : (
              // MESSAGES LIST
              <div className="space-y-8 pb-10">
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
                      className={`max-w-[85%] flex gap-4 ${
                        msg.role === "user" ? "flex-row-reverse" : "flex-row"
                      }`}
                    >
                      {/* Avatar */}
                      <div
                        className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 shadow-sm ${
                          msg.role === "user"
                            ? "bg-slate-900 text-white"
                            : "bg-white border border-emerald-100"
                        }`}
                      >
                        {msg.role === "user" ? (
                          <User size={16} />
                        ) : (
                          <Sparkles className="text-emerald-600" size={16} />
                        )}
                      </div>

                      {/* Bubble */}
                      <div className="group relative space-y-2 max-w-full">
                        <div
                          className={`p-5 rounded-[28px] text-sm md:text-base leading-relaxed shadow-sm transition-all ${
                            msg.role === "user"
                              ? "bg-slate-900 text-white rounded-tr-none"
                              : "bg-white text-slate-700 border border-slate-100 rounded-tl-none"
                          }`}
                        >
                          {msg.role === "user" ? (
                            msg.content
                          ) : (
                            // --- MARKDOWN RENDERER ---
                            <div className="prose prose-sm max-w-none">
                              <ReactMarkdown
                                remarkPlugins={[remarkGfm]}
                                components={{
                                  // --- CUSTOM TABLE STYLING ---
                                  table: ({ node, ...props }) => (
                                    <div className="overflow-x-auto my-4 rounded-xl border border-slate-200 shadow-sm">
                                      <table
                                        className="w-full text-sm text-left text-slate-600"
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
                                      className="px-6 py-4 font-semibold tracking-wider"
                                      {...props}
                                    />
                                  ),
                                  td: ({ node, ...props }) => (
                                    <td
                                      className="px-6 py-4 border-b border-slate-50 last:border-0"
                                      {...props}
                                    />
                                  ),
                                  tr: ({ node, ...props }) => (
                                    <tr
                                      className="bg-white hover:bg-slate-50/50 transition-colors"
                                      {...props}
                                    />
                                  ),
                                  // --- CUSTOM LIST & BOLD STYLING ---
                                  ul: ({ node, ...props }) => (
                                    <ul
                                      className="list-disc pl-5 space-y-2 my-2 marker:text-emerald-500"
                                      {...props}
                                    />
                                  ),
                                  ol: ({ node, ...props }) => (
                                    <ol
                                      className="list-decimal pl-5 space-y-2 my-2 marker:text-emerald-500 font-medium"
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

                          {/* Copy Button */}
                          {msg.role === "assistant" && (
                            <button
                              onClick={() => handleCopy(msg.content, msg.id)}
                              className="absolute -right-12 top-0 p-2 rounded-full bg-white border border-slate-100 text-slate-400 hover:text-emerald-600 hover:shadow-md transition-all opacity-0 group-hover:opacity-100"
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

                {/* ANIMATED DOTS (Visible only when 'Thinking') */}
                {isThinking && (
                  <motion.div
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex justify-start"
                  >
                    <div className="flex gap-4 items-center">
                      <div className="w-9 h-9 rounded-full bg-white border border-emerald-100 flex items-center justify-center shadow-sm">
                        <Sparkles
                          className="text-emerald-600 animate-pulse"
                          size={16}
                        />
                      </div>
                      <div className="bg-white border border-slate-100 p-4 px-6 rounded-[24px] rounded-tl-none flex items-center gap-1.5 shadow-sm">
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
                    <div className="ml-14 flex flex-wrap gap-2 animate-in fade-in slide-in-from-bottom-2">
                      {suggestions.map((sug, i) => (
                        <button
                          key={i}
                          onClick={() => {
                            setInput(sug);
                            if (textareaRef.current)
                              textareaRef.current.focus();
                          }}
                          className="px-4 py-2 bg-white border border-emerald-100 text-emerald-700 text-xs rounded-full hover:bg-emerald-50 transition-colors shadow-sm"
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
        <div className="p-6 md:p-8 bg-white border-t border-slate-100 relative">
          <AnimatePresence>
            {attachedFile && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                className="absolute -top-16 left-8 flex items-center gap-3 bg-white border border-emerald-100 p-2 pr-4 rounded-2xl shadow-xl z-20"
              >
                <div className="w-10 h-10 bg-emerald-50 rounded-xl flex items-center justify-center text-emerald-600">
                  <FileText size={20} />
                </div>
                <div className="flex flex-col">
                  <span className="text-xs font-bold text-slate-700 truncate max-w-[150px]">
                    {attachedFile.name}
                  </span>
                  <span className="text-[10px] text-slate-400">
                    {(attachedFile.size / 1024).toFixed(1)} KB
                  </span>
                </div>
                <button
                  onClick={() => setAttachedFile(null)}
                  className="ml-2 p-1 hover:text-red-500 text-slate-300 transition-colors"
                >
                  <X size={16} />
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="max-w-4xl mx-auto">
            <div className="flex items-end gap-4">
              <div className="mb-1.5">
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
                  className="rounded-full w-12 h-12 border-slate-200 text-slate-400 hover:text-emerald-600 transition-colors shadow-sm"
                >
                  <Paperclip size={22} />
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
                  className="w-full min-h-[56px] py-4 pl-6 pr-16 rounded-[28px] border border-slate-200 bg-slate-50/50 focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all text-sm resize-none overflow-y-auto outline-none block leading-relaxed no-scrollbar"
                />
                <Button
                  onClick={() => handleSubmit()}
                  disabled={
                    status === "in_progress" || (!input.trim() && !attachedFile)
                  }
                  size="icon"
                  className="absolute right-2 bottom-2 h-10 w-10 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg shadow-emerald-600/20 disabled:opacity-50 transition-all"
                >
                  <Send size={18} />
                </Button>
              </div>
            </div>
            <p className="text-center text-[8px] text-slate-400 mt-5 uppercase tracking-[0.25em] font-bold">
              All About Tax AI can make mistakes. Verify important info.
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
