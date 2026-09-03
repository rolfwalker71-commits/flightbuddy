import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { AppShell } from "@/components/layout/app-shell";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, name: true },
  });
  // JWT survived a DB wipe — force re-registration instead of FK crashes.
  if (!user) redirect("/register");

  return <AppShell userName={user.name ?? session.user.name}>{children}</AppShell>;
}
