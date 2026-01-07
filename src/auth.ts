import NextAuth, { type DefaultSession } from "next-auth"
import Google from "next-auth/providers/google"
import { PrismaAdapter } from "@auth/prisma-adapter"
import { prisma } from "@/lib/db"
import type { Adapter } from "next-auth/adapters"

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma) as Adapter, // <--- Connects to DB
  providers: [Google],
  callbacks: {
    // This adds the role to the session so you can use it in the frontend
    session({ session, user }) {
      if (session.user) {
        session.user.role = user.role; // Add role to session
        session.user.id = user.id;     // Add User ID to session
      }
      return session
    },
  },
})