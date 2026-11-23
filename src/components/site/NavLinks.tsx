"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/ask", label: "Ask" },
  { href: "/library", label: "Library" },
  { href: "/forms", label: "Tax forms", soon: true },
  { href: "/#faq", label: "FAQ" },
];

export default function NavLinks() {
  const path = usePathname();
  return (
    <>
      {LINKS.map((link) => {
        const current = path === link.href || path.startsWith(`${link.href}/`);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={current ? "page" : undefined}
            className={`px-3 py-2.5 hover:text-ink-soft ${current ? "font-semibold underline decoration-2 underline-offset-[6px]" : "no-underline"}`}
          >
            {link.label}
            {link.soon && (
              <span className="ml-1.5 inline-block bg-brand px-1.5 py-px font-mono text-[11px] font-semibold text-paper">
                SOON
              </span>
            )}
          </Link>
        );
      })}
    </>
  );
}
