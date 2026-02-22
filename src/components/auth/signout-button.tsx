"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase";
import { Button, type ButtonProps } from "@/components/ui/button";

export function SignOutButton({ ...props }: ButtonProps) {
  const t = useTranslations();
  const router = useRouter();

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

  return (
    <Button onClick={handleSignOut} {...props}>
      {t("auth.signOut")}
    </Button>
  );
}
