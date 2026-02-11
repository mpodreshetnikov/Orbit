"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MedicationForm } from "@/components/medications";
import { useCreateRegimen, useAddOneTimeDoseToRegimen } from "@/hooks";
import { regenerateMedicationEvents, getClientTimezone } from "@/lib/medication-events";
import { useUIStore } from "@/stores/ui-store";
import type { CreateMedRegimenInput, AddOneTimeToExistingPayload } from "@/types/regimen";
import { isAddOneTimeToExistingPayload } from "@/types/regimen";
import type { MedicationKind } from "@/types";

export default function NewMedicationPage() {
  const t = useTranslations();
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedPersonId = useUIStore((state) => state.selectedPersonId);
  const createMutation = useCreateRegimen();
  const addOneTimeDoseMutation = useAddOneTimeDoseToRegimen();
  const kindParam = searchParams.get("kind");
  const defaultKind: MedicationKind =
    kindParam === "one_time" || kindParam === "regular" ? kindParam : "regular";

  if (!selectedPersonId) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <p>{t("person.selectPrompt")}</p>
      </div>
    );
  }

  const handleSubmit = async (data: CreateMedRegimenInput | AddOneTimeToExistingPayload) => {
    if (isAddOneTimeToExistingPayload(data)) {
      await addOneTimeDoseMutation.mutateAsync({
        person_id: selectedPersonId,
        regimen_id: data.addToRegimenId,
        scheduled_at: data.scheduled_at,
        amount: data.amount,
        unit: data.unit,
        notes: data.notes ?? null,
      });
      router.push(`/health/medications/${data.addToRegimenId}`);
      return;
    }
    const regimen = await createMutation.mutateAsync(data);
    await regenerateMedicationEvents(getClientTimezone(), regimen.person_id);
    router.push(`/health/medications/${regimen.id}`);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
          <Link href="/health/medications">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <h1 className="text-xl font-semibold">{t("medications.add")}</h1>
      </div>

      <div className="max-w-md">
        <MedicationForm
          mode="create"
          personId={selectedPersonId}
          defaultKind={defaultKind}
          onSubmit={handleSubmit}
          isPending={createMutation.isPending || addOneTimeDoseMutation.isPending}
          onCancel={() => router.push("/health/medications")}
        />
      </div>
    </div>
  );
}
