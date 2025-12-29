"use client";

import { useChat } from "@/components/chat/ChatContext";
import ChatInterface from "@/components/chat/ChatInterface";
import { Bot, MessageCircle, Sparkles, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export default function ChatWidget() {
  const { status, isOpen, messages } = useChat();
  const isThinking = status === "in_progress";
  // Check if there are messages and the last one is from the assistant (response ready)
  const hasResponse = messages.length > 0 && !isThinking;

  return (
    <div className="fixed bottom-4 right-4 z-[100] md:bottom-8 md:right-8 print:hidden">
      {/* Status Indicator (Tooltip-like) */}
      <AnimatePresence>
        {isThinking && !isOpen && (
          <motion.div
            initial={{ opacity: 0, x: 20, scale: 0.9 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 10, scale: 0.9 }}
            className="absolute bottom-full right-0 mb-3 whitespace-nowrap"
          >
            <div className="bg-white border border-emerald-100 px-4 py-2 rounded-2xl shadow-lg flex items-center gap-2 text-sm font-medium text-slate-700">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              AI is writing...
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <ChatInterface
        trigger={
          <button
            className={`group relative h-14 w-14 md:h-16 md:w-16 rounded-full shadow-2xl flex items-center justify-center transition-all duration-300 hover:scale-105 active:scale-95 ${
              isOpen
                ? "hidden"
                : isThinking
                ? "bg-slate-900"
                : hasResponse
                ? "bg-emerald-600 hover:bg-emerald-700"
                : "bg-slate-900 hover:bg-emerald-600"
            }`}
          >
            {/* Thinking Animation State */}
            {isThinking && !isOpen ? (
              <div className="absolute inset-0 rounded-full border-2 border-emerald-400/50 border-t-emerald-400 animate-spin" />
            ) : null}

            <div className="text-white relative z-10 transition-transform duration-300 group-hover:rotate-12">
              {isOpen ? (
                <X size={28} />
              ) : isThinking ? (
                <Sparkles size={28} className="animate-pulse" />
              ) : (
                <Bot size={32} strokeWidth={1.5} />
              )}
            </div>

            {/* Notification Badge if not open (optional, maybe for future reply tracking) */}
            {/* <span className="absolute top-0 right-0 h-4 w-4 bg-red-500 rounded-full border-2 border-white" /> */}
          </button>
        }
      />
    </div>
  );
}
