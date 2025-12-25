"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, Minus, HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";

const faqData = [
  {
    id: "basics",
    label: "Basics & Forms",
    questions: [
      {
        question: "How do I know which ITR I need to file?",
        answer:
          "Different tax returns are prescribed for filing by individual taxpayers depending on their source of income and residential status. To determine the correct ITR to file, you can use the 'Help me decide which ITR Form to file' option on the portal.",
      },
      {
        question: "What documents do I need to file ITR-1?",
        answer:
          "You need AIS, Form 16, house rent receipts, investment proofs, and premium receipts. However, ITRs are annexure-less forms, so you don't need to attach these documents, just keep them for your records.",
      },
      {
        question: "What income does NOT form part of ITR-1?",
        answer:
          "ITR-1 excludes: (a) Profits from business/profession, (b) Short/Long term capital gains (u/s 112A > 1.25L), (c) Income from >1 house property, (d) Lottery winnings/race horses, (e) Section 115BBDA/115BBE income.",
      },
      {
        question: "Is it mandatory to define employment nature?",
        answer:
          "Yes, you must select from: Central/State Govt, PSU, Pensioners, Private Sector, or Not Applicable (family pension).",
      },
    ],
  },
  {
    id: "filing",
    label: "Filing Process",
    questions: [
      {
        question: "What precautions should I take while filing?",
        answer:
          "Carefully select the tax regime, reconcile AIS/Form 26AS data, verify pre-filled details (PAN, Bank), identify the correct ITR form, and ensure you e-Verify after filing.",
      },
      {
        question: "Is e-Filing and e-Payment the same thing?",
        answer:
          "No. e-Filing is electronically submitting your Return on the portal, while e-Payment is the process of electronically paying the tax liability.",
      },
      {
        question: "Can I correct a mistake in my filed ITR?",
        answer:
          "Yes, you can file a Revised Return u/s 139(5) three months before the end of the relevant Assessment Year (e.g., by 31st Dec 2025 for AY 2025-26).",
      },
      {
        question: "What happens if I file after the due date?",
        answer:
          "You may have to pay a late fee up to ₹5,000, and interest on tax liability. Also, losses cannot be carried forward, and certain deductions/exemptions become unavailable.",
      },
      {
        question: "Can I file ITR for the last 4 years now?",
        answer:
          "Yes, you can file ITR-U (Updated Return) if you missed filing for the previous four years, subject to certain conditions and additional tax.",
      },
    ],
  },
  {
    id: "regimes",
    label: "Tax & Regimes",
    questions: [
      {
        question: "Is the new tax regime the default?",
        answer:
          "Yes. From AY 2024-25, the new tax regime is the default option. You can manually opt for the old regime every year if beneficial.",
      },
      {
        question: "How do I opt out of the New Tax Regime?",
        answer:
          "For ITR-1/2, you can simply select 'Opting out of new regime' in the form. No separate form is needed. Business income filers (ITR-3/4/5) must file Form 10-IEA.",
      },
      {
        question: "What is the Rebate u/s 87A?",
        answer:
          "Section 87A allows a rebate of up to ₹12,500 under the old tax regime (income ≤ ₹5L) and up to ₹25,000 under the new tax regime (income ≤ ₹7L).",
      },
      {
        question: "What is Advance Tax?",
        answer:
          "If your tax liability exceeds ₹10,000/year (beyond TDS), you must pay Advance Tax in quarterly installments (June, Sept, Dec, March) to avoid interest.",
      },
      {
        question: "How is Advance Tax calculated?",
        answer:
          "Pay 15% by 15th June, 45% by 15th Sept, 75% by 15th Dec, and 100% by 15th March. For Self-Assessment Tax, pay any remaining dues before filing the return.",
      },
    ],
  },
  {
    id: "income",
    label: "Income & Deductions",
    questions: [
      {
        question: "Are allowances and perquisites similar?",
        answer:
          "No. Allowances are fixed periodic amounts (e.g., HRA, LTA) that may be exempt. Perquisites are non-monetary benefits (e.g., car, housing) provided by the employer, which may be taxable.",
      },
      {
        question: "Are all donations 100% exempted?",
        answer:
          "No. Donations qualify for either 50% or 100% deduction, with or without a qualifying limit, depending on the institution (e.g., PM Relief Fund vs. private NGO). Check your receipt details.",
      },
      {
        question: "Can I file ITR-1 for rental income?",
        answer:
          "Yes, if you own a SINGLE property (single/joint owner). If you have income from more than one house property, you cannot use ITR-1.",
      },
      {
        question: "Is there a change in House Property schedule?",
        answer:
          "From AY 2025-26, a new Section 24(b) schedule requires details of the lender, loan account number, sanction date, and outstanding loan amount for interest claims.",
      },
      {
        question: "Do I need to give details for 80C deductions?",
        answer:
          "Yes. From AY 2025-26, checking '80C' isn't enough. You must provide the specific amount eligible and the Policy/Document Identification Number.",
      },
      {
        question: "Will I get a refund if I try to verify?",
        answer:
          "Excess tax paid can be claimed as a refund by filing checks. The department processes the return and credits the amount to your bank account after verification.",
      },
    ],
  },
];

export default function FAQ() {
  const [activeTab, setActiveTab] = useState(faqData[0].id);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const activeCategory = faqData.find((cat) => cat.id === activeTab);

  return (
    <section id="faq" className="py-24 bg-white">
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
            Everything you need to know about Indian Taxes and our platform.
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
                  : "text-slate-600 bg-slate-100 hover:bg-slate-200"
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
                            : "text-slate-900 group-hover:text-emerald-600"
                        )}
                      >
                        {faq.question}
                      </span>
                      <div
                        className={cn(
                          "shrink-0 transition-transform duration-500",
                          isOpen
                            ? "rotate-180 text-emerald-600"
                            : "text-slate-400 group-hover:text-slate-600"
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
