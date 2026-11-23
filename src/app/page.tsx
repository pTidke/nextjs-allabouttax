import Link from "next/link";
import WaitlistForm from "@/components/site/WaitlistForm";
import { libraryStats } from "@/lib/tax/library-stats";

export const dynamic = "force-dynamic";

const EXAMPLES = [
  "What does Circular No. 3/2026 cover?",
  "What changed in the Income-tax Act, 2025?",
];

const STEPS = [
  {
    title: "Straight from the source",
    text: "We use the official PDFs from the Income Tax Department, nothing else.",
  },
  {
    title: "Checked word for word",
    text: "A person checks every line against the original page.",
  },
  {
    title: "Checked by a CA",
    text: "A chartered accountant confirms who it covers and from when.",
  },
];

const FAQ = [
  {
    q: "Why can't it answer some questions?",
    a: "It only answers from documents that have been checked. If none of them covers your question yet, it says so instead of guessing.",
  },
  {
    q: "How do I check an answer?",
    a: "Every answer lists its sources. Open the original PDF and go to the page and paragraph it names.",
  },
  {
    q: "What about a notification that names one company?",
    a: "Include the company's full legal name in your question. A notification for one taxpayer can't be assumed to apply to another.",
  },
  {
    q: "Does it cover GST?",
    a: "Not yet. Only central income tax for now.",
  },
  {
    q: "Should I paste my PAN or Form 16?",
    a: "No. Keep questions general and leave out PAN, Aadhaar, bank details and passwords.",
  },
  {
    q: "Is it tax advice?",
    a: "No. It explains what the official documents say. For your own case, speak to a qualified professional.",
  },
];

export default async function HomePage() {
  // The numbers are a nice-to-have: the page still works without the database.
  const stats = await libraryStats().catch(() => null);
  return (
    <main>
      <section className="mx-auto flex max-w-4xl flex-col items-center gap-6 px-6 pb-20 pt-20 text-center md:pt-28">
        <p className="label-mono text-ink-soft">
          Indian income tax · reviewed official sources
        </p>
        <h1 className="font-serif text-[40px] font-bold leading-[1.08] tracking-tight md:text-[64px]">
          Tax questions, answered with the{" "}
          <span className="bg-brand-soft px-1.5">exact line</span> they came
          from.
        </h1>
        <p className="max-w-2xl text-lg text-ink-soft md:text-xl">
          Ask in plain English. Every answer comes from an official CBDT
          document that a person has checked.
        </p>
        <form
          action="/ask"
          className="mt-3 flex w-full max-w-2xl border-2 border-ink bg-paper"
        >
          <label htmlFor="home-q" className="sr-only">
            Your question
          </label>
          <input
            id="home-q"
            name="q"
            required
            maxLength={6000}
            placeholder="Ask anything about income tax…"
            className="min-h-16 min-w-0 flex-1 bg-transparent px-5 text-lg outline-none"
          />
          <button
            type="submit"
            className="cursor-pointer bg-ink px-8 font-semibold text-paper hover:bg-brand-strong"
          >
            Ask
          </button>
        </form>
        <div className="flex flex-wrap justify-center gap-2.5 text-[15px]">
          {EXAMPLES.map((q) => (
            <Link
              key={q}
              href={`/ask?q=${encodeURIComponent(q)}`}
              className="flex min-h-11 items-center border border-dashed border-ink px-3.5 no-underline hover:bg-paper"
            >
              {q}
            </Link>
          ))}
        </div>
        <p className="text-sm text-ink-soft">
          Free · sign in with Google to ask
        </p>
      </section>

      <section
        aria-labelledby="trust"
        className="border-y border-ink bg-paper"
      >
        <div className="mx-auto flex max-w-6xl flex-col gap-12 px-6 py-20">
          <h2
            id="trust"
            className="text-center font-serif text-3xl font-bold md:text-4xl"
          >
            Why you can trust an answer
          </h2>
          <ol className="grid gap-12 md:grid-cols-3">
            {STEPS.map((step, i) => (
              <li key={step.title} className="flex flex-col gap-2.5">
                <span className="font-serif text-5xl font-bold leading-none text-brand">
                  {i + 1}
                </span>
                <strong className="text-xl">{step.title}</strong>
                <span className="text-ink-soft">{step.text}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-6 py-20">
        <div className="flex flex-wrap items-center gap-x-14 gap-y-8 border-2 border-ink bg-paper p-8 md:p-12">
          <div className="flex min-w-0 flex-[3_1_26rem] flex-col gap-3.5">
            <p>
              <span className="bg-brand px-2 py-0.5 font-mono text-[13px] font-semibold text-paper">
                COMING SOON
              </span>
            </p>
            <h2 className="font-serif text-3xl font-bold leading-tight md:text-[38px]">
              Fill your tax return, one checked line at a time.
            </h2>
            <p className="text-lg text-ink-soft">
              Add your Form 16 and AIS. Every figure on the form shows where it
              came from. You file it yourself.
            </p>
          </div>
          <div className="flex min-w-0 flex-[2_1_18rem] flex-col gap-3">
            <WaitlistForm layout="stack" />
            <Link href="/forms" className="text-[15px]">
              See how it will work →
            </Link>
          </div>
        </div>
      </section>

      {stats && (
        <section
          aria-labelledby="knows"
          className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 pb-20"
        >
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 border-t-[3px] border-double border-ink pt-8">
            <h2 id="knows" className="font-serif text-3xl font-bold">
              What it knows
            </h2>
            <Link href="/library" className="ml-auto">
              Browse the library →
            </Link>
          </div>
          <dl className="grid grid-cols-2 gap-8 md:grid-cols-4">
            {[
              [stats.notifications, "CBDT notifications collected"],
              [stats.circulars, "CBDT circulars collected"],
              [stats.guidance, "official guidance pages"],
              [stats.ready, "checked and ready to answer from"],
            ].map(([n, label]) => (
              <div key={label} className="flex flex-col-reverse justify-end gap-1">
                <dt className="text-ink-soft">{label}</dt>
                <dd className="font-serif text-5xl font-bold leading-none md:text-6xl">
                  {n}
                </dd>
              </div>
            ))}
          </dl>
          <p className="text-ink-soft">
            New documents are added as the CBDT publishes them. Only ones that
            pass both checks are used in answers.
          </p>
        </section>
      )}

      <section
        id="faq"
        aria-labelledby="faq-title"
        className="scroll-mt-20 border-t border-ink bg-paper"
      >
        <div className="mx-auto flex max-w-3xl flex-col gap-7 px-6 py-20">
          <h2
            id="faq-title"
            className="text-center font-serif text-3xl font-bold md:text-4xl"
          >
            Questions
          </h2>
          <div className="border-t border-ink">
            {FAQ.map((item) => (
              <details
                key={item.q}
                className="group border-b border-rule px-1 py-5"
              >
                <summary className="flex justify-between gap-4 text-lg font-medium">
                  <span>{item.q}</span>
                  <span aria-hidden="true" className="group-open:rotate-45">
                    +
                  </span>
                </summary>
                <p className="mt-3 text-ink-soft">{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
