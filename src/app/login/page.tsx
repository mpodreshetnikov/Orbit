import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { isUserAllowed } from "@/lib/supabase-server";
import { LoginForm } from "@/components/auth/login-form";

export default async function LoginPage() {
  const t = await getTranslations();

  // If already authenticated and allowed, redirect to app
  const isAllowed = await isUserAllowed();
  if (isAllowed) {
    redirect("/health");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <h1 className="text-3xl font-bold tracking-tight">{t("auth.welcome")}</h1>
          <p className="mt-2 text-muted-foreground">{t("auth.subtitle")}</p>
        </div>
        <LoginForm />
      </div>
    </div>
  );
}
