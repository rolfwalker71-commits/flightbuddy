import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { RegisterForm } from "@/components/auth/register-form";
import { getRequestPrefs } from "@/lib/i18n/prefs";
import { t } from "@/lib/i18n/messages";

export default async function RegisterPage() {
  const session = await auth();
  if (session?.user) redirect("/");
  const { locale } = await getRequestPrefs();
  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6">
      <h1 className="text-3xl font-semibold tracking-tight">{t(locale, "auth.registerTitle")}</h1>
      <p className="mt-2 text-muted-foreground">{t(locale, "auth.registerSubtitle")}</p>
      <RegisterForm />
    </div>
  );
}
