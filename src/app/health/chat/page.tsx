import { getTranslations } from "next-intl/server";
import { AppShell } from "@/components/layout";
import { MessageSquare } from "lucide-react";

export default async function HealthChatPage() {
  const t = await getTranslations();

  return (
    <AppShell>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {t("health.chat")}
          </h1>
          <p className="text-muted-foreground">
            Chat with AI about your health records
          </p>
        </div>

        {/* Empty state */}
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
          <MessageSquare className="h-12 w-12 text-muted-foreground/50" />
          <h3 className="mt-4 text-lg font-semibold">Health Chat</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Coming in Stage 5. Upload medical records first to enable AI chat.
          </p>
        </div>
      </div>
    </AppShell>
  );
}
