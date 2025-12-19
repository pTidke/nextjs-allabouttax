"use client";

import { motion, useScroll, useTransform } from "framer-motion";
import { Calculator, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRef } from "react";

export default function CTA() {
  const containerRef = useRef(null);

  // Subtle parallax effect on scroll
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start end", "end start"],
  });

  const y = useTransform(scrollYProgress, [0, 1], [0, -50]);

  return (
    <section ref={containerRef} className="py-24 bg-white overflow-hidden">
      <div className="container mx-auto px-6 lg:max-w-[74%]">
        <motion.div
          style={{ y }}
          initial={{ opacity: 0, scale: 0.98 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{
            duration: 1.2,
            ease: [0.16, 1, 0.3, 1],
          }}
          className="relative rounded-[48px] bg-[#fbfdfc] border border-emerald-200/100 p-12 md:p-20 text-center overflow-hidden shadow-[0_30px_100px_rgba(16,185,129,0.04)]"
        >
          {/* Animated Background Elements */}
          <motion.div
            animate={{
              scale: [1, 1.2, 1],
              opacity: [0.3, 0.5, 0.3],
            }}
            transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
            className="absolute -top-1/2 -left-1/4 w-[600px] h-[600px] bg-emerald-50/50 rounded-full blur-[120px] pointer-events-none"
          />

          <div className="relative z-10 max-w-3xl mx-auto flex flex-col items-center">
            {/* Floating Icon Animation */}
            <motion.div
              animate={{ y: [0, -10, 0] }}
              transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
              className="mb-10 w-16 h-16 rounded-3xl bg-white border border-emerald-50 flex items-center justify-center shadow-sm shadow-emerald-200/20"
            >
              <Calculator className="text-emerald-600" size={28} />
            </motion.div>

            {/* Typography with staggered entrance */}
            <motion.h2
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, duration: 0.8 }}
              className="font-serif text-4xl md:text-5xl font-medium text-slate-900 tracking-tight leading-[1.1]"
            >
              Input Your Finances. <br />
              <span className="italic text-emerald-800">
                We'll handle the rest.
              </span>
            </motion.h2>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4, duration: 0.8 }}
              className="mt-8 text-slate-500 text-lg md:text-xl leading-relaxed max-w-2xl"
            >
              No more manual slab calculations. Simply provide your details and
              get a precision-engineered breakdown.
            </motion.p>

            {/* Sexy Magnetic Button Animation */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.6, duration: 0.8 }}
              className="mt-12"
            >
              <Button
                size="lg"
                className="group relative rounded-full bg-slate-900 px-10 py-8 text-lg text-white hover:bg-slate-800 transition-all duration-300 shadow-xl shadow-slate-200"
              >
                <span className="relative z-10 flex items-center">
                  Start Calculating Now
                  <ArrowRight
                    className="ml-2 transition-transform duration-500 group-hover:translate-x-2"
                    size={22}
                  />
                </span>
                {/* Subtle shine effect on hover */}
                <motion.div
                  className="absolute inset-0 rounded-full bg-gradient-to-r from-transparent via-white/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"
                  animate={{ x: ["-100%", "100%"] }}
                  transition={{
                    duration: 1.5,
                    repeat: Infinity,
                    ease: "linear",
                  }}
                />
              </Button>
            </motion.div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
