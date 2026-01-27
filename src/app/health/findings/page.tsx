"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Search, LayoutGrid, List } from "lucide-react";
import { AppShell } from "@/components/layout";
import { Input } from "@/components/ui/input";
import { Toggle } from "@/components/ui/toggle";
import { Skeleton } from "@/components/ui/skeleton";
import { FindingCard } from "@/components/findings";
import { usePersonFindingHistory } from "@/hooks";
import { useUIStore } from "@/stores/ui-store";

function FindingsContent() {
  const t = useTranslations();
  const { selectedPersonId } = useUIStore();
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<"cards" | "table">("cards");

  const { data: findings, isLoading } = usePersonFindingHistory(selectedPersonId, search);

  if (!selectedPersonId) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <p>{t("common.selectPerson")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">{t("findings.title")}</h1>
        <p className="text-muted-foreground">{t("findings.description")}</p>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("findings.searchPlaceholder")}
            className="pl-9"
          />
        </div>
        <div className="flex items-center border rounded-md">
          <Toggle
            pressed={viewMode === "cards"}
            onPressedChange={() => setViewMode("cards")}
            className="rounded-r-none"
            aria-label={t("common.cardView")}
          >
            <LayoutGrid className="h-4 w-4" />
          </Toggle>
          <Toggle
            pressed={viewMode === "table"}
            onPressedChange={() => setViewMode("table")}
            className="rounded-l-none border-l"
            aria-label={t("common.tableView")}
          >
            <List className="h-4 w-4" />
          </Toggle>
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      ) : findings && findings.length > 0 ? (
        viewMode === "cards" ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {findings.map((finding, index) => {
              const key = `${finding.finding_code || finding.finding_type_text}-${finding.site_code || finding.body_site_text || "none"}-${index}`;
              return <FindingCard key={key} finding={finding} />;
            })}
          </div>
        ) : (
          <div className="rounded-lg border">
            <table className="w-full">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left p-3 font-medium">{t("findings.findingType")}</th>
                  <th className="text-left p-3 font-medium">{t("findings.bodySite")}</th>
                  <th className="text-left p-3 font-medium">{t("findings.size")}</th>
                  <th className="text-left p-3 font-medium">{t("findings.severity")}</th>
                  <th className="text-left p-3 font-medium">{t("findings.laterality")}</th>
                  <th className="text-left p-3 font-medium">{t("findings.occurrences")}</th>
                </tr>
              </thead>
              <tbody>
                {findings.map((finding, index) => {
                  const key = `${finding.finding_code || finding.finding_type_text}-${finding.site_code || finding.body_site_text || "none"}-${index}`;
                  const findingName = finding.catalog_finding_name_ru || finding.finding_type_text;
                  const siteName = finding.catalog_site_name_ru || finding.body_site_text || "-";
                  
                  return (
                    <tr key={key} className="border-b hover:bg-muted/30">
                      <td className="p-3">
                        <div>
                          <span className="font-medium">{findingName}</span>
                          {finding.finding_code && (
                            <code className="ml-2 text-xs text-muted-foreground">
                              {finding.finding_code}
                            </code>
                          )}
                        </div>
                      </td>
                      <td className="p-3">{siteName}</td>
                      <td className="p-3">
                        {finding.latest_size_mm !== null ? `${finding.latest_size_mm} ${t("findings.mm")}` : "-"}
                      </td>
                      <td className="p-3">{t(`findings.severityOptions.${finding.latest_severity}`)}</td>
                      <td className="p-3">
                        {finding.latest_laterality !== "none" 
                          ? t(`findings.lateralityOptions.${finding.latest_laterality}`)
                          : "-"
                        }
                      </td>
                      <td className="p-3">{finding.occurrence_count}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      ) : (
        <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
          <p className="text-lg">{t("findings.noFindings")}</p>
          <p className="text-sm mt-1">{t("findings.noFindingsDescription")}</p>
        </div>
      )}
    </div>
  );
}

export default function FindingsPage() {
  return (
    <AppShell>
      <FindingsContent />
    </AppShell>
  );
}
