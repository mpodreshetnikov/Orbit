"use client";

import React, { useEffect } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

/**
 * Medical document upload was removed from the UI (Maxim decision B).
 * Ingest is MCP-only; keep this route as a soft redirect so old bookmarks do not 404.
 */
export default function NewRecordPage() {
  const t = useTranslations();
  const router = useRouter();

  useEffect(() => {
    router.replace("/health");
  }, [router]);

  return (
    <div className="mx-auto flex max-w-lg flex-col items-center justify-center gap-4 rounded-lg border border-dashed p-12 text-center">
      <h1 className="text-xl font-semibold">{t("records.uploadRemoved.title")}</h1>
      <p className="text-sm text-muted-foreground">{t("records.uploadRemoved.body")}</p>
      <Button onClick={() => router.push("/health")}>{t("records.uploadRemoved.back")}</Button>
    </div>
  );
}
