"use client";

import Navbar from "@/components/navigation/Navbar";
import { Button } from "@/components/ui/button";
import { ArrowRight, Sparkles } from "lucide-react";
import { motion, Variants } from "framer-motion";
import Image from "next/image";
import BlogUpdates from "@/components/sections/BlogUpdates";
import Features from "@/components/sections/AllFeatures";
import FAQ from "@/components/sections/FAQ";
import Footer from "@/components/navigation/Footer";
import CTA from "@/components/sections/CTA";
import { ShieldCheck } from "lucide-react";
import ChatInterface from "@/components/chat/ChatInterface";

export default function LandingPage() {
  const containerVariants: Variants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.15,
        delayChildren: 0.3,
      },
    },
  };

  const itemVariants: Variants = {
    hidden: { opacity: 0, y: 30 },
    visible: {
      opacity: 1,
      y: 0,
      transition: {
        duration: 2,
        ease: [0.16, 1, 0.3, 1],
      },
    },
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#fafafa]">
      <Navbar />

      <main className="container mx-auto px-8 pb-16 pt-14 lg:pt-26 lg:pb-16">
        <motion.div
          className="max-w-full lg:max-w-[90%] mx-auto grid grid-cols-1 gap-16 lg:grid-cols-2 lg:items-center"
          initial="hidden"
          animate="visible"
          variants={containerVariants}
        >
          {/* LEFT CONTENT */}
          <div className="flex flex-col items-center text-center lg:items-start lg:text-left max-w-2xl mx-auto lg:mx-0">
            <motion.div
              variants={itemVariants}
              className="inline-flex items-center gap-2 rounded-full bg-emerald-100 px-3 py-1 text-sm font-medium text-emerald-800"
            >
              <Sparkles size={12} />
              <span>New: Income Tax Act 2025 Support</span>
            </motion.div>

            <motion.h1
              variants={itemVariants}
              className="mt-6 font-serif text-5xl font-medium leading-[1.1] tracking-tight text-slate-900 md:text-7xl"
            >
              Tax queries, <br />
              <span className="italic text-emerald-800 underline decoration-emerald-200 underline-offset-8">
                answered!
              </span>
            </motion.h1>

            <motion.p
              variants={itemVariants}
              className="mt-8 text-md md:text-xl leading-relaxed text-slate-600"
            >
              Your AI partner for the Indian tax regime. Ask complex questions,
              get cited answers from official acts, and plan your finances in
              plain English.
            </motion.p>

            {/* BUTTONS: w-fit ensures they don't stretch; lg:justify-start aligns them left on desktop */}
            <motion.div
              variants={itemVariants}
              className="mt-10 flex flex-col items-center sm:flex-row gap-4 w-full lg:w-auto justify-center lg:justify-start"
            >
              <ChatInterface
                trigger={
                  <Button className="bg-emerald-600 rounded-full px-8">
                    Ask AI Assistant
                  </Button>
                }
              />
              <Button
                size="lg"
                variant="outline"
                className="rounded-full px-8 text-sm border-slate-300 text-slate-900 hover:bg-slate-50 transition-all w-fit"
                asChild // This allows the button to behave like the child anchor tag
              >
                <a href="#features">Browse Features</a>
              </Button>
            </motion.div>
          </div>

          {/* RIGHT CONTENT - Using the local SVG file */}
          <motion.div
            variants={itemVariants}
            className="relative w-full flex justify-center items-center"
          >
            <div className="relative w-full max-w-[540px] aspect-square">
              <Image
                src="/illustrations/tax-hero.svg"
                alt="Tax Illustration"
                fill
                priority
                className="object-contain"
              />
            </div>

            {/* Glowing background behind the SVG */}
            <div className="absolute -left-10 -top-10 -z-10 h-64 w-64 rounded-full bg-emerald-100/40 blur-[100px]" />
            <div className="absolute -right-10 -bottom-10 -z-10 h-64 w-64 rounded-full bg-slate-200/40 blur-[100px]" />
          </motion.div>
        </motion.div>
      </main>

      {/* NEW FEATURES SECTION */}
      <Features />

      <CTA />

      {/* BLOG UPDATES SECTION */}
      <BlogUpdates />

      {/* FAQ SECTION */}
      <FAQ />

      <div className="py-14 bg-emerald-50/30 border-t border-emerald-100/50">
        <div className="container mx-auto px-6 lg:max-w-[70%]">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            className="flex flex-col md:flex-row items-center gap-8 md:gap-12"
          >
            {/* Centered Icon Container */}
            <div className="flex-shrink-0 flex items-center justify-center">
              <div className="w-16 h-16 rounded-2xl bg-white flex items-center justify-center border border-emerald-100 shadow-sm shadow-emerald-200/20">
                <ShieldCheck className="text-emerald-600" size={32} />
              </div>
            </div>

            <div className="flex-1 text-center md:text-left">
              <h3 className="text-lg font-bold text-slate-900 mb-3 tracking-tight">
                Professional Transparency Note
              </h3>
              {/* text-justify applied here */}
              <p className="text-slate-500 text-sm md:text-base leading-relaxed text-justify">
                Please note that all tax calculations and guidance provided by
                this AI assistant are indicative in nature and based on the
                programmed logic of FY 2025-26 rules. Tax laws can be subject to
                interpretation and individual circumstances may vary. Users are
                strongly advised to consult with a qualified Chartered
                Accountant or tax professional for official filing, legal
                advice, and final verification.
              </p>
            </div>
          </motion.div>
        </div>
      </div>

      <Footer />
    </div>
  );
}
