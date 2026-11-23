import Link from "next/link";
import LegalModals from "@/components/modals/LegalModals";

export default function Footer() {
  return (
    <footer className="bg-ink text-paper print:hidden">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-7 gap-y-2 px-6 py-7 text-sm">
        <span className="font-serif text-lg font-bold">All About Tax</span>
        <span className="text-rule">
          Sources: incometaxindia.gov.in · not tax advice
        </span>
        <nav
          aria-label="Footer"
          className="flex flex-wrap gap-x-6 gap-y-2 md:ml-auto"
        >
          <Link href="/library" className="text-paper">
            Library
          </Link>
          <Link href="/contact" className="text-paper">
            Contact
          </Link>
          <LegalModals
            type="privacy"
            trigger={
              <button
                type="button"
                className="cursor-pointer underline underline-offset-3"
              >
                Privacy
              </button>
            }
          />
          <LegalModals
            type="terms"
            trigger={
              <button
                type="button"
                className="cursor-pointer underline underline-offset-3"
              >
                Terms
              </button>
            }
          />
        </nav>
      </div>
    </footer>
  );
}
