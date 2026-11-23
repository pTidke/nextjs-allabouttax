import WaitlistForm from "@/components/site/WaitlistForm";

export const metadata = {
  title: "Tax forms — coming soon",
  description:
    "Fill your income-tax return one checked line at a time. Join the waitlist.",
};

const PREVIEW = [
  { label: "Gross salary", value: "₹ 12,40,000", checked: true },
  { label: "Standard deduction", value: "₹ 75,000", checked: true },
  { label: "Tax deducted (TDS)", value: "₹ 1,08,500", checked: false },
  { label: "Employer's TAN", value: "MUMA12345B", checked: true },
];

const STEPS = [
  ["Answer a few questions", "So only the right form comes up."],
  ["Add your documents", "Form 16, AIS, interest certificates."],
  ["Check every line", "Each figure links to its source."],
  ["File it yourself", "Download it for the e-filing portal."],
];

export default function FormsPage() {
  return (
    <main>
      <section className="mx-auto flex max-w-3xl flex-col items-center gap-6 px-6 pb-20 pt-20 text-center md:pt-28">
        <p>
          <span className="bg-brand px-2.5 py-1 font-mono text-[13px] font-semibold text-paper">
            COMING SOON
          </span>
        </p>
        <h1 className="font-serif text-[40px] font-bold leading-[1.1] tracking-tight md:text-[58px]">
          Fill your tax return, one checked line at a time.
        </h1>
        <p className="max-w-2xl text-lg text-ink-soft md:text-xl">
          Every figure on your form shows the document it came from, so you can
          check it before you file.
        </p>
        <div className="mt-2 w-full max-w-xl">
          <WaitlistForm />
        </div>
        <p className="text-sm text-ink-soft">
          One email when it opens. Nothing else.
        </p>
      </section>

      <section
        aria-labelledby="preview"
        className="border-y border-ink bg-paper"
      >
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-16 gap-y-10 px-6 py-20">
          <div className="flex min-w-0 flex-[1_1_20rem] flex-col gap-3.5">
            <h2
              id="preview"
              className="font-serif text-3xl font-bold leading-tight md:text-4xl"
            >
              No number you can&apos;t check.
            </h2>
            <p className="text-ink-soft">
              Next to each figure is a tick once you&apos;ve checked it. If your
              Form 16 and your AIS disagree, we show you both and you choose.
            </p>
          </div>
          <figure className="flex min-w-0 flex-[1_1_26rem] flex-col gap-3">
            <div className="border-2 border-ink bg-paper">
              <div className="flex items-center border-b border-ink px-5 py-3">
                <strong>Income from salary</strong>
                <span className="ml-auto font-mono text-[13px] text-ink-soft">
                  3 of 4 checked
                </span>
              </div>
              <dl className="px-5 pb-3 pt-2">
                {PREVIEW.map((row) => (
                  <div
                    key={row.label}
                    className={`flex items-center gap-3 border-b border-rule py-3 last:border-b-0 ${row.checked ? "" : "-mx-3 bg-brand-soft px-3 font-semibold"}`}
                  >
                    <dt className="flex-1">{row.label}</dt>
                    <dd className="font-mono font-semibold">{row.value}</dd>
                    <span
                      className={`flex h-7 w-7 items-center justify-center border border-ink text-sm ${row.checked ? "bg-ink text-paper" : "bg-paper"}`}
                    >
                      {row.checked ? "✓" : ""}
                      <span className="sr-only">
                        {row.checked ? "checked" : "to check"}
                      </span>
                    </span>
                  </div>
                ))}
              </dl>
            </div>
            <figcaption className="text-[15px] text-ink-soft">
              An example. Tax deducted: Form 16 and AIS show different figures,
              so it waits for you.
            </figcaption>
          </figure>
        </div>
      </section>

      <section
        aria-labelledby="steps"
        className="mx-auto flex w-full max-w-6xl flex-col gap-12 px-6 py-20"
      >
        <h2
          id="steps"
          className="text-center font-serif text-3xl font-bold md:text-4xl"
        >
          Four steps
        </h2>
        <ol className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map(([title, text], i) => (
            <li
              key={title}
              className="flex flex-col gap-2.5 border-t-2 border-ink pt-5"
            >
              <span className="font-serif text-[40px] font-bold leading-none text-brand">
                {i + 1}
              </span>
              <strong className="text-lg">{title}</strong>
              <span className="text-ink-soft">{text}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="mx-auto w-full max-w-3xl px-6 pb-24">
        <div className="flex flex-col gap-5 border-2 border-ink bg-paper p-8 md:p-11">
          <h2 className="font-serif text-2xl font-bold md:text-3xl">
            Our promises
          </h2>
          <ul className="flex flex-col gap-4 text-lg">
            {[
              "We never file for you or sign in to the portal.",
              "You choose what to upload, and you can delete it at any time.",
              "It starts with the common ITR forms. The order isn't decided yet.",
            ].map((line) => (
              <li key={line} className="flex items-baseline gap-3.5">
                <span
                  aria-hidden="true"
                  className="h-3 w-3 flex-none bg-brand"
                />
                {line}
              </li>
            ))}
          </ul>
        </div>
      </section>
    </main>
  );
}
