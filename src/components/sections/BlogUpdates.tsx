"use client";

import { motion } from "framer-motion";
import { Info } from "lucide-react";

const articles = [
  {
    category: "PERIOD",
    title: "Start with the relevant period",
    description:
      "Choose FY, AY or Tax Year before asking. The assistant checks the reviewed scope against that selection.",
    color: "bg-blue-50 text-blue-600",
  },
  {
    category: "EVIDENCE",
    title: "Read the official passage",
    description:
      "Citations lead to official documents. Check their conditions and effective dates before applying an explanation.",
    color: "bg-blue-50 text-blue-600",
  },
  {
    category: "COVERAGE",
    title: "See what is available",
    description:
      "The reviewed source library shows fresh published documents for your period. A missing answer can mean the material is outside current coverage.",
    color: "bg-blue-50 text-blue-600",
  },
  {
    category: "UPDATES",
    title: "New material goes through review",
    description:
      "Source checking and legal review are separate steps. Changed text becomes pending so older approvals do not silently carry over.",
    color: "bg-blue-50 text-blue-600",
  },
];

export default function BlogUpdates() {
  return (
    <section id="updates" className="py-24 bg-[#fafafa]">
      <div className="container mx-auto px-6 lg:max-w-[75%]">
        {/* Smoother Header Entrance */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{
            duration: 1.2,
            ease: [0.16, 1, 0.3, 1], // Custom quintic ease-out
          }}
          className="text-center mb-16"
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            whileInView={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.2, duration: 0.5 }}
            className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white border border-slate-200 text-blue-600 text-xs font-bold tracking-widest uppercase mb-4 shadow-sm"
          >
            <Info size={14} />
            <span>How it works</span>
          </motion.div>

          <h2 className="font-serif text-3xl font-medium text-slate-900 md:text-4xl tracking-tight">
            Ask, inspect, and verify
          </h2>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {articles.map((article, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{
                duration: 0.8,
                delay: index * 0.15,
                ease: [0.21, 0.45, 0.32, 0.9],
              }}
              // Elastic Spring Hover
              whileHover={{
                y: -12,
                scale: 1.01,
                transition: {
                  type: "spring",
                  stiffness: 400,
                  damping: 25,
                },
              }}
              whileTap={{ scale: 0.98 }}
              className="group p-8 rounded-[32px] bg-white border border-slate-100 shadow-sm hover:shadow-[0_20px_40px_rgba(0,0,0,0.04)] transition-all duration-500 ease-out"
            >
              <span
                className={`inline-block px-3 py-1 rounded-lg text-[10px] font-bold tracking-wider uppercase mb-6 transition-transform duration-500 group-hover:scale-105 ${article.color}`}
              >
                {article.category}
              </span>

              <h3 className="text-xl font-bold text-slate-900 mb-4 leading-tight group-hover:text-blue-700 transition-colors duration-300">
                {article.title}
              </h3>

              <p className="text-slate-500 text-sm md:text-base leading-relaxed">
                {article.description}
              </p>

              {/* Subtle underline decoration that grows on hover */}
              <div className="mt-6 w-0 h-[2px] bg-blue-600 transition-all duration-500 group-hover:w-12 opacity-50" />
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
