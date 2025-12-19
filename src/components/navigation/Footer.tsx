"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import LegalModals from "../modals/LegalModals";

export default function Footer() {
  return (
    <footer className="w-full">
      {/* 1. Professional Transparency Note - Vertically Centered & Justified */}

      {/* 2. Bottom Navigation - Subtle Gradient Background */}
      <div className="py-12 bg-gradient-to-b from-white to-slate-50/50 border-t border-slate-100">
        <div className="container mx-auto px-6 lg:max-w-[90%]">
          <div className="flex flex-col md:flex-row items-center justify-between gap-10">
            {/* Minimalist Brand Logo */}
            <Link href="/" className="flex items-center gap-1 group">
              <span className="font-serif text-2xl font-bold tracking-tight text-slate-900 transition-colors group-hover:text-slate-700">
                allabouttax
              </span>
              <span className="text-sm font-semibold text-emerald-700">
                .in
              </span>
            </Link>

            {/* Links & Attribution */}
            <div className="flex flex-col items-center md:items-end gap-4">
              <nav className="flex flex-wrap justify-center gap-x-8 gap-y-2">
                <LegalModals
                  type="privacy"
                  trigger={
                    <button className="text-slate-400 hover:text-emerald-700 text-sm font-medium transition-colors cursor-pointer">
                      Privacy Policy
                    </button>
                  }
                />
                <LegalModals
                  type="terms"
                  trigger={
                    <button className="text-slate-400 hover:text-emerald-700 text-sm font-medium transition-colors cursor-pointer">
                      Terms of Service
                    </button>
                  }
                />
                <Link
                  href="/contact"
                  className="text-slate-400 hover:text-emerald-700 text-sm font-medium transition-colors"
                >
                  Contact Support
                </Link>
              </nav>

              <div className="flex flex-col md:flex-row items-center gap-3 text-xs tracking-tight">
                <span className="text-slate-400">
                  © 2025 All About Tax. All rights reserved.
                </span>
                <span className="hidden md:block text-slate-200">|</span>
                <a
                  href="https://storyset.com/people"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-slate-300 hover:text-emerald-600 transition-colors italic"
                >
                  People illustrations by Storyset
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
