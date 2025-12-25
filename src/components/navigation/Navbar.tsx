import Link from "next/link";
import { Button } from "@/components/ui/button";
import ChatInterface from "../chat/ChatInterface";

export default function Navbar() {
  return (
    <nav className="sticky top-0 z-50 w-full border-b border-slate-200 bg-white/80 backdrop-blur-md">
      <div className="container mx-auto flex h-18 items-center justify-between px-6">
        {/* Left: Logo */}
        <Link href="/" className="flex items-center gap-1">
          <span className="font-serif text-2xl font-bold tracking-tight text-slate-900">
            allabouttax
          </span>
          <span className="text-sm font-semibold text-emerald-700">.in</span>
        </Link>

        {/* Right: Actions */}
        <div className="flex items-center gap-6">
          <ChatInterface
            trigger={
              <Button className="hidden md:inline-flex bg-emerald-600 rounded-full px-8">
                Ask AI Assistant
              </Button>
            }
          />
        </div>
      </div>
    </nav>
  );
}
