"use client";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface LegalModalProps {
  type: "privacy" | "terms";
  trigger: React.ReactNode;
}

export default function LegalModals({ type, trigger }: LegalModalProps) {
  const isPrivacy = type === "privacy";

  return (
    <Dialog>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="flex max-h-[85vh] max-w-2xl flex-col gap-0 border-2 border-ink bg-paper p-0 text-ink shadow-none">
        <div className="border-b border-ink px-8 py-6 pr-16">
          <DialogTitle className="font-serif text-2xl font-bold">
            {isPrivacy ? "Privacy Policy" : "Terms of Service"}
          </DialogTitle>
          <p className="label-mono mt-1 text-ink-soft">
            Last updated · November 2026
          </p>
        </div>
        <div className="flex flex-col gap-8 overflow-y-auto px-8 py-8">
          <p className="text-lg text-ink-soft">
            {isPrivacy
                ? "At All About Tax, we value your privacy. This policy explains what information we collect, how we use it, and your rights. We believe in transparency and keeping your data safe."
                : "Welcome to All About Tax. By using our website and AI assistant, you agree to the following terms. Please read them carefully to understand your rights and responsibilities."}
          </p>
            <div className="flex flex-col gap-7">
              {isPrivacy ? (
                <>
                  <LegalSection
                    title="Information We Collect"
                    content="Google sign-in provides your name, email and profile image. We store your account, chat messages, citations and usage counters in our PostgreSQL database. If you use the contact form, we store your name, email address and message so that we can reply. Avoid including PAN, Aadhaar, bank details or other sensitive identifiers in questions."
                  />
                  <LegalSection
                    title="How We Use Information"
                    content="Your current question, a limited recent chat history and relevant official passages are sent to our Azure-hosted model to generate answers. When the reviewed sources cannot answer a question, our administrator may read that question, without your name or email address, to decide which official sources to add next. The application requests responses with storage disabled at the API level; provider logging and retention follow the provider’s policies. Google supplies authentication, Neon hosts the database, and Vercel analytics components collect service usage information when enabled."
                  />
                  <LegalSection
                    title="Data Security & Third Parties"
                    content="Your conversations are restricted to your signed-in account. Open Your conversations to download or permanently delete a conversation from the application database. Closing a chat does not delete it. Backup and service-provider retention are separate from deletion in the app."
                  />
                  <LegalSection
                    title="Your Responsibility"
                    content="Please do not share sensitive personal or financial details (like bank passwords or login credentials) in the chat. Interactions should be treated as informational only."
                  />
                </>
              ) : (
                <>
                  <LegalSection
                    title="Informational Purpose Only"
                    content="All About Tax is an AI-powered educational tool. Explanations are for reference and depend on the reviewed source coverage. This release does not calculate tax or file returns. They do NOT constitute official legal, financial, or tax advice."
                  />
                  <LegalSection
                    title="Not a Substitute for Professional Advice"
                    content="While we strive for accuracy, tax rules are complex. Always verify information with a qualified Chartered Accountant (CA) or tax professional before filing taxes or making financial decisions."
                  />
                  <LegalSection
                    title="User Responsibility & Liability"
                    content="You are solely responsible for how you use this platform. All About Tax and its creators accept no liability for any penalties, losses, or damages. The final decision rests with you."
                  />
                  <LegalSection
                    title="Service Availability"
                    content="We aim for smooth operation but cannot guarantee uninterrupted service. We reserve the right to modify, suspend, or discontinue the service at any time without notice."
                  />
                  <LegalSection
                    title="Prohibited Use"
                    content="You agree not to use this service for unlawful purposes, harassment, or to attempt to damage platform security. Misuse may result in restricted access."
                  />
                </>
              )}
            </div>

          <div className="flex flex-col items-center gap-4 border-t border-rule pt-6 text-center">
            <p className="max-w-sm text-sm text-ink-soft">
              By continuing to use this site, you acknowledge that you have read
              and understood these documents.
            </p>
            <DialogClose asChild>
              <button
                type="button"
                className="min-h-11 cursor-pointer bg-ink px-8 font-semibold text-paper hover:bg-brand-strong"
              >
                I understand
              </button>
            </DialogClose>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function LegalSection({ title, content }: { title: string; content: string }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-serif text-lg font-bold">{title}</h3>
      <p className="text-ink-soft">{content}</p>
    </section>
  );
}
