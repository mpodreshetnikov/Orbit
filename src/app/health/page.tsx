import { getTranslations } from "next-intl/server";
import { AppShell } from "@/components/layout";
import { FileText, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

export default async function HealthPage() {
  const t = await getTranslations();

  return (
    <AppShell>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              {t("health.title")}
            </h1>
            <p className="text-muted-foreground">{t("health.description")}</p>
          </div>
          <Button disabled>
            <Plus className="mr-2 h-4 w-4" />
            Add Record
          </Button>
        </div>

        {/* Empty state */}
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
          <FileText className="h-12 w-12 text-muted-foreground/50" />
          <h3 className="mt-4 text-lg font-semibold">No medical records yet</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Upload your first medical record to get started.
          </p>
          <Button className="mt-4" disabled>
            <Plus className="mr-2 h-4 w-4" />
            Add Record
          </Button>
        </div>
      </div>
    </AppShell>
  );
}
