"use client";

import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { signOut } from "next-auth/react";

export default function SignOutMenuItem() {
  return (
    <DropdownMenuItem
      className="cursor-pointer px-3 py-2"
      onSelect={(e) => {
        e.preventDefault(); // Prevent closing immediately if needed, though signOut redirects
        signOut();
      }}
    >
      <span>Sign out</span>
    </DropdownMenuItem>
  );
}
