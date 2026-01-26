"use client";

import { useTranslations } from "next-intl";
import { AppShell } from "@/components/layout";
import { MessageSquare, UserX } from "lucide-react";
import { useUIStore } from "@/stores/ui-store";
import { usePersons } from "@/hooks";

export default function HealthChatPage() {
  const t = useTranslations();
  const selectedPersonId = useUIStore((state) => state.selectedPersonId);
  const { data: persons } = usePersons();

  const selectedPerson = persons?.find((p) => p.id === selectedPersonId);

  // No person selected state
  if (!selectedPerson) {
    return (
      <AppShell>
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
          <UserX className="h-12 w-12 text-muted-foreground/50" />
          <h3 className="mt-4 text-lg font-semibold">{t("person.noPerson")}</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("person.selectPrompt")}
          </p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {t("health.chat")} — {selectedPerson.name}
          </h1>
          <p className="text-muted-foreground">
            {t("health.chatDescription")}
          </p>
        </div>

        {/* Empty state */}
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
          <MessageSquare className="h-12 w-12 text-muted-foreground/50" />
          <h3 className="mt-4 text-lg font-semibold">{t("health.chat")}</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("health.chatComingSoon")}
          </p>
        </div>
      </div>
    </AppShell>
  );
}
