"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/components/i18n/prefs-provider";

export function RegisterForm() {
  const t = useT();
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password }),
    });
    const json = await res.json();
    if (!res.ok) {
      setLoading(false);
      setError(json.error ?? t("auth.registerFailed"));
      return;
    }
    const login = await signIn("credentials", { email, password, redirect: false });
    setLoading(false);
    if (login?.error) {
      router.push("/login");
      return;
    }
    router.push("/");
  }

  return (
    <form onSubmit={onSubmit} className="mt-8 space-y-4">
      <div className="space-y-2">
        <Label htmlFor="name">{t("auth.name")}</Label>
        <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="email">{t("auth.email")}</Label>
        <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">{t("auth.password")}</Label>
        <Input
          id="password"
          type="password"
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" className="w-full" disabled={loading}>
        {t("auth.createAccount")}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        <Link href="/login">{t("auth.hasAccount")}</Link>
      </p>
    </form>
  );
}
