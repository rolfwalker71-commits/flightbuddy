import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { authConfig } from "@/auth.config";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  callbacks: {
    ...authConfig.callbacks,
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as { role?: string }).role ?? "USER";
        return token;
      }

      const id = String(token.id ?? token.sub ?? "");
      if (!id) return {};

      // JWT can outlive a wiped DB (e.g. fresh local Postgres). Drop the session
      // so the user re-registers instead of hitting FK errors on save.
      const existing = await prisma.user.findUnique({
        where: { id },
        select: { id: true, role: true },
      });
      if (!existing) return {};

      token.id = existing.id;
      token.role = existing.role;
      return token;
    },
    async session({ session, token }) {
      if (!token.id) {
        // Stale JWT after DB reset — leave an empty id so callers treat as logged out.
        if (session.user) {
          session.user.id = "";
          session.user.role = "USER";
        }
        return session;
      }
      if (session.user) {
        session.user.id = String(token.id);
        session.user.role = String(token.role ?? "USER");
      }
      return session;
    },
  },
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = String(credentials?.email ?? "").toLowerCase().trim();
        const password = String(credentials?.password ?? "");
        if (!email || !password) return null;
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) return null;
        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) return null;
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
          role: user.role,
        };
      },
    }),
  ],
});
