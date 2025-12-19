"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, Minus, HelpCircle } from "lucide-react";

const faqs = [
  {
    question: "What taxes does this tool cover?",
    answer:
      "We primarily cover Indian Income Tax for individuals (Salaried & Business), including capital gains and deductions. We also answer general queries regarding GST for freelancers and small businesses.",
  },
  {
    question: "Can it calculate my exact tax liability?",
    answer:
      "Yes! You can enter your income sources and deductions, and our AI will provide a detailed estimation based on the latest FY 2025-26 slabs.",
  },
  {
    question: "Is this suitable for beginners?",
    answer:
      "Absolutely. We designed 'All About Tax' specifically for users who may not be familiar with finance. The AI avoids jargon and explains every step clearly.",
  },
  {
    question: "Is the information up to date?",
    answer:
      "Yes, our system is optimized with knowledge of the latest Indian Union Budget and tax laws applicable for the Financial Year 2025-26.",
  },
  {
    question: "Do I need prior tax knowledge to use this?",
    answer:
      "Not at all. You just need to know your own financial details. The assistant will guide you through the rest.",
  },
];

export default function FAQ() {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  return (
    <section id="faq" className="py-24 bg-white">
      {/* 80% Max Width Container */}
      <div className="container mx-auto px-6 lg:max-w-[80%]">
        {/* Section Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          className="text-center mb-20"
        >
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-slate-50 text-slate-600 mb-6 border border-slate-100">
            <HelpCircle size={22} />
          </div>
          <h2 className="font-serif text-3xl font-medium text-slate-900 md:text-4xl tracking-tight">
            Frequently Asked Questions
          </h2>
          <p className="mt-4 text-slate-500 max-w-lg mx-auto">
            Common queries about navigating the 2025 tax landscape with our AI
            assistant.
          </p>
        </motion.div>

        {/* Minimalist Accordion (Replacing Cards) */}
        <div className="max-w-3xl mx-auto">
          {faqs.map((faq, index) => {
            const isOpen = activeIndex === index;
            return (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
                className="border-b border-slate-100"
              >
                <button
                  onClick={() => setActiveIndex(isOpen ? null : index)}
                  className="w-full py-7 flex items-center justify-between text-left group"
                >
                  <span
                    className={`text-lg font-medium transition-colors duration-300 ${
                      isOpen
                        ? "text-emerald-700"
                        : "text-slate-900 group-hover:text-emerald-600"
                    }`}
                  >
                    {faq.question}
                  </span>
                  <div
                    className={`shrink-0 ml-4 transition-transform duration-500 ${
                      isOpen
                        ? "rotate-180 text-emerald-600"
                        : "text-slate-400 group-hover:text-slate-600"
                    }`}
                  >
                    {isOpen ? <Minus size={20} /> : <Plus size={20} />}
                  </div>
                </button>

                <AnimatePresence>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{
                        duration: 0.4,
                        ease: [0.04, 0.62, 0.23, 0.98],
                      }}
                      className="overflow-hidden"
                    >
                      <div className="pb-8 pr-12 text-slate-600 leading-relaxed text-base">
                        {faq.answer}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
