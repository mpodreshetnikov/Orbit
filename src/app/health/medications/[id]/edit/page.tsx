"use client";

import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MedicationForm } from "@/components/medications";
import { useRegimen, useUpdateRegimen } from "@/hooks";
import { Skeleton } from "@/components/ui/skeleton";
import { regimenToMedication, updateMedicationInputToRegimenInput } from "@/lib/medication-regimen-adapter";
import { regenerateMedicationEvents, getClientTimezone } from "@/lib/medication-events";
import type { UpdateMedicationInput } from "@/types";

export default function EditMedicationPage() {
  const params = useParams();
  const router = useRouter();
  const t = useTranslations();
  const id = params.id as string;

  const { data: regimen, isLoading, error } = useRegimen(id);
  const updateMutation = useUpdateRegimen();
  const medication = regimen ? regimenToMedication(regimen) : null;

  const handleSubmit = async (data: UpdateMedicationInput) => {
    const updates = updateMedicationInputToRegimenInput(data);
    await updateMutation.mutateAsync({ id, updates });
    if (regimen) {
      await regenerateMedicationEvents(getClientTimezone(), regimen.person_id);
    }
    router.push(`/health/medications/${id}`);
  };

  if (isLoading || !regimen || !medication) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center text-muted-foreground py-8">
        <p>{t("common.error")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
          <Link href={`/health/medications/${id}`}>
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <h1 className="text-xl font-semibold">{t("medications.edit")}</h1>
      </div>

      <div className="max-w-md">
        <MedicationForm
          mode="edit"
          initial={medication}
          personId={regimen.person_id}
          onSubmit={handleSubmit}
          isPending={updateMutation.isPending}
          onCancel={() => router.push(`/health/medications/${id}`)}
        />
      </div>
    </div>
  );
}
