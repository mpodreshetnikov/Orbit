import { getTranslations } from "next-intl/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { Button } from "@/components/ui/button";
import { AlertCircle } from "lucide-react";
import Link from "next/link";
import { SignOutButton } from "@/components/auth/signout-button";

export default async function AccessDeniedPage() {
  const t = await getTranslations();
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-6 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
          <AlertCircle className="h-8 w-8 text-destructive" />
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight">{t("auth.accessDenied.title")}</h1>
          <p className="text-muted-foreground">{t("auth.accessDenied.message")}</p>
          {user && (
            <p className="mt-4 text-sm text-muted-foreground">
              {t("auth.accessDenied.loggedInAs")}: {user.email}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-2">
          {user ? (
            <SignOutButton variant="outline" className="w-full" />
          ) : (
            <Button asChild className="w-full">
              <Link href="/login">{t("auth.signIn")}</Link>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
