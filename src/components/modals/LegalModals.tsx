"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import {
  ShieldCheck,
  Scale,
  CheckCircle2,
  AlertTriangle,
  Ban,
  Globe,
} from "lucide-react";

interface LegalModalProps {
  type: "privacy" | "terms";
  trigger: React.ReactNode;
}

export default function LegalModals({ type, trigger }: LegalModalProps) {
  const isPrivacy = type === "privacy";

  return (
    <Dialog>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[85vh] rounded-[40px] border border-slate-100 shadow-2xl p-0 overflow-hidden bg-white outline-none">
        {/* Header Section */}
        <div className="p-8 border-b border-slate-50 flex items-center gap-5 bg-gradient-to-r from-emerald-50/40 to-transparent relative z-20">
          <div className="w-14 h-14 rounded-2xl bg-white flex items-center justify-center border border-emerald-100 shadow-sm shadow-emerald-200/10">
            {isPrivacy ? (
              <ShieldCheck className="text-emerald-600" size={28} />
            ) : (
              <Scale className="text-emerald-600" size={28} />
            )}
          </div>
          <DialogHeader className="text-left">
            <DialogTitle className="text-2xl font-serif font-bold text-slate-900 tracking-tight">
              {isPrivacy ? "Privacy Policy" : "Terms of Service"}
            </DialogTitle>
            <div className="flex items-center gap-2 mt-1">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <p className="text-[11px] text-slate-400 font-bold uppercase tracking-[0.15em]">
                Last Updated • Dec 2025
              </p>
            </div>
          </DialogHeader>
        </div>

        {/* Content Area */}
        <ScrollArea className="h-full max-h-[70vh]">
          <div className="px-10 pt-12 pb-10 space-y-10">
            {/* Intro Section */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
              className="relative p-7 rounded-[32px] bg-emerald-50/30 border border-emerald-100/50 italic text-slate-600 text-sm md:text-base leading-relaxed"
            >
              <div className="absolute -top-3.5 left-7 px-4 py-1 bg-white border border-emerald-100 rounded-full text-[10px] font-extrabold text-emerald-700 uppercase tracking-widest shadow-sm z-30">
                Official Statement
              </div>
              {isPrivacy
                ? "At All About Tax, we value your privacy. This policy explains what information we collect, how we use it, and your rights. We believe in transparency and keeping your data safe."
                : "Welcome to All About Tax. By using our website and AI assistant, you agree to the following terms. Please read them carefully to understand your rights and responsibilities."}
            </motion.div>

            {/* Content Logic */}
            <div className="space-y-10">
              {isPrivacy ? (
                <>
                  <LegalSection
                    icon={<Globe size={18} />}
                    title="Information We Collect"
                    content="We collect basic information to provide our services effectively. This includes text you input into our chat interface and standard technical usage data. We do not collect personally identifiable information (PII) like your Aadhar or PAN unless you explicitly type it, which we strongly advise against."
                  />
                  <LegalSection
                    icon={<CheckCircle2 size={18} />}
                    title="How We Use Information"
                    content="Data is used solely to operate, maintain, and improve All About Tax. Your chat inputs are processed by AI algorithms to provide relevant tax answers. We analyze aggregated, non-personal usage trends to fix technical issues."
                  />
                  <LegalSection
                    icon={<ShieldCheck size={18} />}
                    title="Data Security & Third Parties"
                    content="We take reasonable measures to protect your data. We do not sell data to advertisers. We may use trusted third-party providers for hosting or analytics, but they are bound by confidentiality obligations."
                  />
                  <LegalSection
                    icon={<AlertTriangle size={18} />}
                    title="Your Responsibility"
                    content="Please do not share sensitive personal or financial details (like bank passwords or login credentials) in the chat. Interactions should be treated as informational only."
                  />
                </>
              ) : (
                <>
                  <LegalSection
                    icon={<AlertTriangle size={18} />}
                    title="Informational Purpose Only"
                    content="All About Tax is an AI-powered educational tool. Responses, calculations, and guidance provided are indicative and for reference only. They do NOT constitute official legal, financial, or tax advice."
                  />
                  <LegalSection
                    icon={<CheckCircle2 size={18} />}
                    title="Not a Substitute for Professional Advice"
                    content="While we strive for accuracy, tax rules are complex. Always verify information with a qualified Chartered Accountant (CA) or tax professional before filing taxes or making financial decisions."
                  />
                  <LegalSection
                    icon={<Scale size={18} />}
                    title="User Responsibility & Liability"
                    content="You are solely responsible for how you use this platform. All About Tax and its creators accept no liability for any penalties, losses, or damages. The final decision rests with you."
                  />
                  <LegalSection
                    icon={<Globe size={18} />}
                    title="Service Availability"
                    content="We aim for smooth operation but cannot guarantee uninterrupted service. We reserve the right to modify, suspend, or discontinue the service at any time without notice."
                  />
                  <LegalSection
                    icon={<Ban size={18} />}
                    title="Prohibited Use"
                    content="You agree not to use this service for unlawful purposes, harassment, or to attempt to damage platform security. Misuse may result in restricted access."
                  />
                </>
              )}
            </div>

            {/* Bottom Close Action */}
            <div className="pt-8 border-t border-slate-100 flex flex-col items-center gap-6 text-center">
              <p className="text-xs text-slate-400 max-w-xs leading-relaxed">
                By continuing to use this platform, you acknowledge that you
                have read and understood these documents.
              </p>
              <DialogClose asChild>
                <Button className="rounded-full px-10 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs uppercase tracking-widest transition-all shadow-lg shadow-emerald-600/20">
                  I Understand
                </Button>
              </DialogClose>
            </div>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

function LegalSection({
  title,
  content,
  icon,
}: {
  title: string;
  content: string;
  icon: React.ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
      className="group space-y-3"
    >
      {/* Header Container */}
      <div className="flex items-center gap-4">
        {/* Fixed width icon container to ensure the vertical line below starts from the center */}
        <div className="w-6 flex justify-center text-emerald-500 group-hover:scale-110 transition-transform duration-500">
          {icon}
        </div>
        <h4 className="font-serif text-lg font-bold text-slate-900 tracking-tight">
          {title}
        </h4>
      </div>

      {/* Content Container with Centered Vertical Line */}
      <div className="relative pl-3 ml-[11px] border-l border-emerald-100 group-hover:border-emerald-300 transition-colors duration-500">
        <p className="text-slate-500 text-sm md:text-base leading-relaxed text-justify pl-6 pr-2">
          {content}
        </p>
      </div>
    </motion.div>
  );
}
