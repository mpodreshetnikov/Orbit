"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/layout";
import { AddRecordWizard } from "@/components/records";
import { useUIStore } from "@/stores/ui-store";
import { usePersons } from "@/hooks";
import { UserX } from "lucide-react";
import { useEffect } from "react";

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
      <AppShell>
        <div className="flex items-center justify-center p-12">
          <p className="text-muted-foreground">{t("common.loading")}</p>
        </div>
      </AppShell>
    );
  }

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
      <AddRecordWizard personId={selectedPerson.id} personName={selectedPerson.name} />
    </AppShell>
  );
}
