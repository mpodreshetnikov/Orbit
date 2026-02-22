"use client";

import React, { useEffect } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { AddRecordWizard } from "@/components/records";
import { useUIStore } from "@/stores/ui-store";
import { usePersons } from "@/hooks";
import { UserX } from "lucide-react";

export default function NewRecordPage() {
  const t = useTranslations();
  const router = useRouter();
  const selectedPersonId = useUIStore((state) => state.selectedPersonId);
  const { data: persons, isLoading } = usePersons();

  const selectedPerson = persons?.find((p) => p.id === selectedPersonId);

  // Redirect if no person selected
  useEffect(() => {
    if (!isLoading && !selectedPerson) {
      router.push("/health");
    }
  }, [isLoading, selectedPerson, router]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <p className="text-muted-foreground">{t("common.loading")}</p>
      </div>
    );
  }

  if (!selectedPerson) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
        <UserX className="h-12 w-12 text-muted-foreground/50" />
        <h3 className="mt-4 text-lg font-semibold">{t("person.noPerson")}</h3>
        <p className="mt-2 text-sm text-muted-foreground">{t("person.selectPrompt")}</p>
      </div>
    );
  }

  return <AddRecordWizard personId={selectedPerson.id} personName={selectedPerson.name} />;
}
