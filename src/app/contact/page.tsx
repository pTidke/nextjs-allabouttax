"use client";

import { motion } from "framer-motion";
import { Send, AlertCircle, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import Navbar from "@/components/navigation/Navbar";
import Footer from "@/components/navigation/Footer";

export default function ContactPage() {
  return (
    <main className="min-h-screen bg-white">
      <Navbar />

      {/* Adjusted padding: pt-32 for desktop, pt-24 for mobile to clear Navbar */}
      <section className="pt-24 md:pt-32 pb-16 md:pb-24">
        <div className="container mx-auto px-6 lg:max-w-[70%]">
          {/* gap-12 on mobile, gap-16 on desktop */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-start">
            {/* Left Side: Information - Centered on mobile, Left-aligned on desktop */}
            <motion.div
              initial={{ opacity: 0, x: -30 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.8 }}
              className="flex flex-col items-center lg:items-start text-center lg:text-left space-y-8 md:space-y-10"
            >
              <div className="space-y-4">
                <h1 className="text-3xl md:text-5xl font-bold text-slate-900 tracking-tight leading-tight">
                  Need help or have <br />
                  <span className="text-emerald-600 font-serif italic">
                    feedback?
                  </span>
                </h1>
                <p className="text-slate-500 text-base md:text-lg leading-relaxed max-w-lg mx-auto lg:mx-0">
                  Whether you're facing a technical issue with the website or
                  have a suggestion to improve our AI, we'd love to hear from
                  you.
                </p>
              </div>

              {/* Important Note Box - Centered icon on mobile, left on desktop */}
              <div className="w-full p-6 md:p-8 rounded-[28px] bg-emerald-50/50 border border-emerald-100 flex flex-col sm:flex-row gap-4 md:gap-5 items-center sm:items-start">
                <div className="flex-shrink-0">
                  <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center border border-emerald-100 shadow-sm">
                    <AlertCircle className="text-emerald-700" size={20} />
                  </div>
                </div>
                <div className="space-y-2">
                  <span className="text-emerald-800 font-bold uppercase tracking-widest text-[11px] block">
                    Important Note
                  </span>
                  <p className="text-slate-600 text-sm md:text-sm leading-relaxed text-center text-justify sm:text-justify mt-2">
                    Our support team handles{" "}
                    <strong>platform and technical issues only</strong>. We
                    cannot provide personal tax advice, file your taxes for you,
                    or answer specific financial questions through this form.
                    Please use the AI chat for general tax queries or consult a
                    CA for professional advice.
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-center lg:justify-start gap-3 text-slate-400 text-sm">
                <Clock size={18} />
                <span>Response time: Usually within 24 hours</span>
              </div>
            </motion.div>

            {/* Right Side: Contact Form */}
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.8, delay: 0.2 }}
              className="w-full p-7 md:p-12 rounded-[40px] bg-white border border-slate-100 shadow-[0_32px_64px_-16px_rgba(0,0,0,0.05)]"
            >
              <form className="space-y-6" onSubmit={(e) => e.preventDefault()}>
                <div className="space-y-2 text-left">
                  <label className="text-sm font-semibold text-slate-700 ml-1">
                    Full Name
                  </label>
                  <Input
                    placeholder="John Doe"
                    className="rounded-2xl border-slate-200 bg-slate-50/30 px-5 py-6 focus-visible:ring-emerald-500/20 focus-visible:border-emerald-500 transition-all"
                  />
                </div>

                <div className="space-y-2 text-left">
                  <label className="text-sm font-semibold text-slate-700 ml-1">
                    Email Address
                  </label>
                  <Input
                    type="email"
                    placeholder="john@example.com"
                    className="rounded-2xl border-slate-200 bg-slate-50/30 px-5 py-6 focus-visible:ring-emerald-500/20 focus-visible:border-emerald-500 transition-all"
                  />
                </div>

                <div className="space-y-2 text-left">
                  <label className="text-sm font-semibold text-slate-700 ml-1">
                    How can we help?
                  </label>
                  <Textarea
                    placeholder="Describe your issue or feedback..."
                    className="rounded-2xl border-slate-200 bg-slate-50/30 px-5 py-4 focus-visible:ring-emerald-500/20 focus-visible:border-emerald-500 transition-all min-h-[150px] resize-none"
                  />
                </div>

                <Button
                  size="lg"
                  className="w-full rounded-full bg-emerald-600 hover:bg-emerald-700 text-white py-8 text-lg font-semibold transition-all group shadow-xl shadow-emerald-600/20"
                >
                  Send Message
                  <Send
                    className="ml-2 transition-transform group-hover:translate-x-1 group-hover:-translate-y-1"
                    size={18}
                  />
                </Button>
              </form>
            </motion.div>
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}
