import Link from "next/link";
import { Button } from "@/components/ui/button";
import { auth, signOut } from "@/auth";
import LoginModal from "@/components/auth/LoginModal";
import SignOutMenuItem from "@/components/auth/SignOutMenuItem";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { User } from "lucide-react";

export default async function Navbar() {
  const session = await auth();
  return (
    <nav className="sticky top-0 z-50 w-full border-b border-slate-200 bg-white/80 backdrop-blur-md">
      <div className="container mx-auto flex h-18 items-center justify-between px-6 relative">
        {/* Left: Logo */}
        <div className="flex-1 flex justify-start">
          <Link href="/" className="flex items-center gap-1 group">
            <span className="font-serif text-2xl font-bold tracking-tight text-slate-900 group-hover:text-emerald-800 transition-colors">
              allabouttax
            </span>
            <span className="text-sm font-semibold text-emerald-700">.in</span>
          </Link>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-4">
          {session?.user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className="relative h-10 w-10 rounded-full p-0 overflow-hidden border border-slate-200"
                >
                  {session.user.image ? (
                    <img
                      src={session.user.image}
                      alt={session.user.name || "User"}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="h-full w-full bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-sm">
                      {(session.user.name?.[0] || "U").toUpperCase()}
                    </div>
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56" align="end" forceMount>
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col space-y-1">
                    <p className="text-sm font-medium leading-none text-slate-900">
                      {session.user.name}
                    </p>
                    <p className="text-xs leading-none text-slate-500">
                      {session.user.email}
                    </p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link
                    href="/profile"
                    className="cursor-pointer w-full flex items-center"
                  >
                    <User className="mr-2 h-4 w-4" />
                    <span>Profile</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <SignOutMenuItem />
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <LoginModal />
          )}
        </div>
      </div>
    </nav>
  );
}
