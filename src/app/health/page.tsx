"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { UserX } from "lucide-react";
import { useUIStore } from "@/stores/ui-store";
import { usePersons } from "@/hooks";
import { RecordsList } from "@/components/records";

export default function HealthPage() {
  const t = useTranslations();
  const selectedPersonId = useUIStore((state) => state.selectedPersonId);
  const { data: persons } = usePersons();

  const selectedPerson = persons?.find((p) => p.id === selectedPersonId);

  // No person selected state
  if (!selectedPerson) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
        <UserX className="h-12 w-12 text-muted-foreground/50" />
        <h3 className="mt-4 text-lg font-semibold">{t("person.noPerson")}</h3>
        <p className="mt-2 text-sm text-muted-foreground">{t("person.selectPrompt")}</p>
      </div>
    );
  }

  return <RecordsList personId={selectedPerson.id} personName={selectedPerson.name} />;
}
