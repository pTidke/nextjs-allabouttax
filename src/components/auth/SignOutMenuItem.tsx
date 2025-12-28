"use client";

import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { signOut } from "next-auth/react";
import { LogOut } from "lucide-react";

export default function SignOutMenuItem() {
  return (
    <DropdownMenuItem
      className="text-red-600 focus:text-red-600 focus:bg-red-50 cursor-pointer"
      onSelect={(e) => {
        e.preventDefault(); // Prevent closing immediately if needed, though signOut redirects
        signOut();
      }}
    >
      <LogOut className="mr-2 h-4 w-4" />
      <span>Sign Out</span>
    </DropdownMenuItem>
  );
}
