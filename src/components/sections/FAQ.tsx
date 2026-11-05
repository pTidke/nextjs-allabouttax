"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, Minus, HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";

const faqData = [
  {
    id: "basics",
    label: "Using the assistant",
    questions: [
      {
        question: "What can I ask?",
        answer:
          "Ask about central income-tax material in the reviewed source library. Choose the relevant FY, AY or Tax Year first. Coverage depends on the specific passages that have been reviewed and published.",
      },
      {
        question: "Why might the assistant be unable to answer?",
        answer:
          "The assistant needs fresh approved evidence matching your question and tax period. A document may still need review, a refresh may be overdue, or the available passage may not answer your question.",
      },
      {
        question: "Where can I check an answer?",
        answer:
          "Each supported answer includes official source citations. Open them to compare the passage, effective dates and tax period with your circumstances.",
      },
    ],
  },
  {
    id: "coverage",
    label: "Sources and coverage",
    questions: [
      {
        question: "Does this cover every Indian tax?",
        answer:
          "The early-access library focuses on selected central income-tax documents. GST, state taxes, complete historical coverage and every filing scenario are outside the current release.",
      },
      {
        question: "How do new rules become available?",
        answer:
          "The background worker discovers and checks official sources. New or changed documents enter a review queue and become available after approval. The library page shows current source availability.",
      },
      {
        question: "What about a notification naming a specific entity?",
        answer:
          "Include the entity’s full legal name in the question. An entity-specific designation cannot be assumed to apply to another taxpayer.",
      },
    ],
  },
  {
    id: "account",
    label: "Account and data",
    questions: [
      {
        question: "Can I revisit or remove my chats?",
        answer:
          "Open Your conversations from your account menu. You can reopen a conversation, download its messages and citations, or permanently delete it from the application database. Starting a new chat only clears the chat window.",
      },
      {
        question: "Should I paste financial documents into chat?",
        answer:
          "Keep questions general and avoid PAN, Aadhaar, bank details and credentials. Document uploads and personal filing preparation are not available in this release.",
      },
      {
        question: "Can the assistant calculate or file my return?",
        answer:
          "Tax calculations, return drafting and filing are planned features. Current answers explain reviewed source material and should be checked before you act.",
      },
    ],
  },
];

export default function FAQ() {
  const [activeTab, setActiveTab] = useState(faqData[0].id);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const activeCategory = faqData.find((cat) => cat.id === activeTab);

  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqData.flatMap((category) =>
      category.questions.map((faq) => ({
        "@type": "Question",
        name: faq.question,
        acceptedAnswer: {
          "@type": "Answer",
          text: faq.answer,
        },
      })),
    ),
  };

  return (
    <section id="faq" className="py-24 bg-white">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
      />
      <div className="container mx-auto px-6 lg:max-w-[80%]">
        {/* Section Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          className="text-center mb-16"
        >
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-slate-50 text-slate-600 mb-6 border border-slate-100">
            <HelpCircle size={22} />
          </div>
          <h2 className="font-serif text-3xl font-medium text-slate-900 md:text-4xl tracking-tight">
            Frequently Asked Questions
          </h2>
          <p className="mt-4 text-slate-500 max-w-lg mx-auto">
            How the reviewed-source assistant works and what this release
            covers.
          </p>
        </motion.div>

        {/* Tabs */}
        <div className="flex flex-wrap justify-center gap-2 mb-12">
          {faqData.map((tab) => (
            <button
              key={tab.id}
              onClick={() => {
                setActiveTab(tab.id);
                setActiveIndex(null); // Reset open accordion on tab switch
              }}
              className={cn(
                "relative px-6 py-2.5 text-sm font-medium rounded-full transition-all duration-300",
                activeTab === tab.id
                  ? "text-white bg-emerald-700 shadow-md shadow-emerald-200/50"
                  : "text-slate-600 bg-slate-100 hover:bg-slate-200",
              )}
            >
              {tab.label}
              {activeTab === tab.id && (
                <motion.div
                  layoutId="activeTab"
                  className="absolute inset-0 bg-emerald-700 rounded-full -z-10"
                  transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                />
              )}
            </button>
          ))}
        </div>

        {/* Accordion Content */}
        <div className="max-w-3xl mx-auto min-h-[400px]">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.3 }}
            >
              {activeCategory?.questions.map((faq, index) => {
                const isOpen = activeIndex === index;
                return (
                  <motion.div
                    key={index}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: index * 0.05 }}
                    className="border-b border-slate-100"
                  >
                    <button
                      onClick={() => setActiveIndex(isOpen ? null : index)}
                      className="w-full py-6 flex items-center justify-between text-left group"
                    >
                      <span
                        className={cn(
                          "text-md font-medium transition-colors duration-300 pr-8",
                          isOpen
                            ? "text-emerald-700"
                            : "text-slate-900 group-hover:text-emerald-600",
                        )}
                      >
                        {faq.question}
                      </span>
                      <div
                        className={cn(
                          "shrink-0 transition-transform duration-500",
                          isOpen
                            ? "rotate-180 text-emerald-600"
                            : "text-slate-400 group-hover:text-slate-600",
                        )}
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
                            duration: 0.3,
                            ease: "easeInOut",
                          }}
                          className="overflow-hidden"
                        >
                          <div className="pb-6 text-slate-600 leading-relaxed text-base">
                            {faq.answer}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                );
              })}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
}
