import Link from "next/link";
import { Button } from "@/components/ui/button";
import ChatInterface from "../chat/ChatInterface";

export default function Navbar() {
  return (
    <nav className="sticky top-0 z-50 w-full border-b border-slate-200 bg-white/80 backdrop-blur-md">
      <div className="container mx-auto flex h-18 items-center justify-between px-6 relative">
        {/* Left/Center: Logo */}
        <div className="flex-1 flex justify-center md:justify-start">
          <Link href="/" className="flex items-center gap-1 group">
            <span className="font-serif text-2xl font-bold tracking-tight text-slate-900 group-hover:text-emerald-800 transition-colors">
              allabouttax
            </span>
            <span className="text-sm font-semibold text-emerald-700">.in</span>
          </Link>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-6 absolute right-6 md:static">
          <ChatInterface
            trigger={
              <Button className="hidden md:inline-flex bg-emerald-600 hover:bg-emerald-700 text-white rounded-full px-8 transition-all duration-300 animate-glow border-none">
                Ask AI Assistant
              </Button>
            }
          />
        </div>
      </div>
    </nav>
  );
}
