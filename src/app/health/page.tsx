"use client";

import { useTranslations } from "next-intl";
import { AppShell } from "@/components/layout";
import { FileText, Plus, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUIStore } from "@/stores/ui-store";
import { usePersons } from "@/hooks";

export default function HealthPage() {
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
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              {t("health.title")} — {selectedPerson.name}
            </h1>
            <p className="text-muted-foreground">{t("health.description")}</p>
          </div>
          <Button disabled>
            <Plus className="mr-2 h-4 w-4" />
            {t("health.addRecord")}
          </Button>
        </div>

        {/* Empty state */}
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
          <FileText className="h-12 w-12 text-muted-foreground/50" />
          <h3 className="mt-4 text-lg font-semibold">
            {t("health.noRecords")}
          </h3>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("health.noRecordsDescription")}
          </p>
          <Button className="mt-4" disabled>
            <Plus className="mr-2 h-4 w-4" />
            {t("health.addRecord")}
          </Button>
        </div>
      </div>
    </AppShell>
  );
}
