import Link from "next/link";
import { auth } from "@/auth";
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
import { reviewerAccess } from "@/lib/review/roles";
import NavLinks from "./NavLinks";

export default async function Header() {
  const session = await auth();
  // A failure here must not break every page, for example before a migration
  // that adds the reviewer tables has been applied.
  const review = session?.user?.id
    ? await reviewerAccess(session.user.id)
        .then((access) => access.admin || access.extraction || access.tax)
        .catch(() => false)
    : false;
  const user = session?.user;
  return (
    <header className="z-50 border-b border-ink bg-paper md:sticky md:top-0 print:hidden">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-8 gap-y-1 px-6 py-3">
        <Link
          href="/"
          className="font-serif text-[26px] font-bold tracking-tight no-underline"
        >
          All About Tax
        </Link>
        <nav
          aria-label="Main"
          className="ml-auto flex flex-wrap items-center text-base"
        >
          <NavLinks />
          <span className="ml-3">
            {user ? (
              <DropdownMenu>
                <DropdownMenuTrigger className="min-h-11 border border-ink bg-paper px-4 hover:bg-shade">
                  {user.name?.split(" ")[0] || "Account"} ▾
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="w-60 border border-ink bg-paper p-0 shadow-none"
                >
                  <DropdownMenuLabel className="border-b border-rule px-3 py-2 font-normal">
                    <span className="block font-medium">{user.name}</span>
                    <span className="block text-sm text-ink-soft">
                      {user.email}
                    </span>
                  </DropdownMenuLabel>
                  <DropdownMenuItem asChild>
                    <Link href="/chats" className="px-3 py-2">
                      Your chats
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/profile" className="px-3 py-2">
                      Profile
                    </Link>
                  </DropdownMenuItem>
                  {(review || user.role === "ADMIN") && (
                    <DropdownMenuSeparator className="m-0 bg-rule" />
                  )}
                  {review && (
                    <DropdownMenuItem asChild>
                      <Link href="/review" className="px-3 py-2">
                        Review documents
                      </Link>
                    </DropdownMenuItem>
                  )}
                  {user.role === "ADMIN" && (
                    <DropdownMenuItem asChild>
                      <Link href="/admin/inbox" className="px-3 py-2">
                        Inbox
                      </Link>
                    </DropdownMenuItem>
                  )}
                  {user.role === "ADMIN" && (
                    <DropdownMenuItem asChild>
                      <Link href="/admin/knowledge" className="px-3 py-2">
                        Knowledge administration
                      </Link>
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator className="m-0 bg-rule" />
                  <SignOutMenuItem />
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <LoginModal />
            )}
          </span>
        </nav>
      </div>
    </header>
  );
}
