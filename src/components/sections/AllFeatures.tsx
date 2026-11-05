"use client";

import { motion } from "framer-motion";
import {
  MessageSquare,
  Calculator,
  ListChecks,
  UserCircle,
  RefreshCw,
} from "lucide-react";

const features = [
  {
    title: "Ask Income-tax Questions",
    description:
      "Ask a focused question and get an explanation when our reviewed official library contains matching evidence.",
    icon: <MessageSquare className="text-emerald-600" size={22} />,
  },
  {
    title: "Choose the Tax Period",
    description:
      "Keep financial years, assessment years and Tax Years explicit. Reviewed dates help put each passage in context.",
    icon: <Calculator className="text-emerald-600" size={22} />,
  },
  {
    title: "Follow the Evidence",
    description:
      "Open citations to the official document and check the passage supporting the answer.",
    icon: <ListChecks className="text-emerald-600" size={22} />,
  },
  {
    title: "Manage Your Conversations",
    description:
      "Reopen your saved questions, export messages with citations, and delete conversations from your account.",
    icon: <UserCircle className="text-emerald-600" size={22} />,
  },
  {
    title: "Reviewed Source Updates",
    description:
      "Official documents are checked by a background worker. New and changed material requires review before publication.",
    icon: <RefreshCw className="text-emerald-600" size={22} />,
  },
];

export default function Features() {
  return (
    <section id="features" className="py-20 bg-white">
      {/* 75% Max Width Container */}
      <div className="container mx-auto px-6 lg:max-w-[75%]">
        {/* Animated Header with Updated Wording */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 2.0, ease: [0.3, 1, 0.3, 1] }}
          className="text-center max-w-4xl mx-auto mb-18"
        >
          <h2 className="font-serif text-3xl font-medium text-slate-900 md:text-3xl tracking-tight">
            Income-tax research with visible sources
          </h2>
          <p className="mt-4 text-base md:text-md text-slate-500 leading-relaxed max-w-xl mx-auto">
            Explore a growing reviewed library, see what is covered, and check
            the evidence behind each answer.
          </p>
        </motion.div>

        {/* Feature Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((feature, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-50px" }}
              transition={{
                duration: 1,
                delay: index * 0.1,
                ease: [0.21, 0.45, 0.32, 0.9],
              }}
              whileHover={{
                y: -8,
                transition: { duration: 0.5, ease: "easeOut" },
              }}
              className="group relative p-8 rounded-3xl border border-slate-100 bg-[#fafafa] hover:bg-white hover:shadow-[0_20px_50px_rgba(16,185,129,0.05)] transition-colors duration-300"
            >
              <div className="w-11 h-11 rounded-2xl bg-emerald-50 flex items-center justify-center mb-6 group-hover:bg-emerald-100 transition-colors duration-300">
                {feature.icon}
              </div>
              <h3 className="text-lg font-semibold text-slate-900 mb-3 tracking-tight">
                {feature.title}
              </h3>
              <p className="text-slate-500 text-sm md:text-base leading-relaxed">
                {feature.description}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
