"use client";

import { useState, useMemo } from "react";
import { useTranslations } from "next-intl";
import { 
  Search, 
  LayoutGrid, 
  List, 
  CheckCircle2, 
  AlertCircle,
  HelpCircle,
  History,
  HeartPulse,
  Info,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { format } from "date-fns";
import { useDateFnsLocale } from "@/lib/date-locale";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ConditionCard } from "@/components/conditions/condition-card";
import { usePersonConditionsWithHistory } from "@/hooks";
import { useUIStore } from "@/stores/ui-store";
import type { ConditionWithHistory, ConditionStatus } from "@/types";

function StatusIcon({ status }: { status: ConditionStatus }) {
  const icons: Record<ConditionStatus, React.ReactNode> = {
    active: <AlertCircle className="h-4 w-4 text-orange-500" />,
    suspected: <HelpCircle className="h-4 w-4 text-yellow-500" />,
    resolved: <CheckCircle2 className="h-4 w-4 text-green-500" />,
    history: <History className="h-4 w-4 text-gray-500" />,
  };
  return icons[status] || null;
}

function ConditionsContent() {
  const t = useTranslations();
  const dateLocale = useDateFnsLocale();
  const { selectedPersonId } = useUIStore();
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<"cards" | "table">("cards");
  const [showStatusTips, setShowStatusTips] = useState(false);

  const { data: conditions, isLoading } = usePersonConditionsWithHistory(selectedPersonId);

  // Filter conditions by search
  const filteredConditions = useMemo(() => {
    if (!conditions) return [];
    if (!search.trim()) return conditions;
    
    const searchLower = search.toLowerCase();
    return conditions.filter(c => 
      c.name.toLowerCase().includes(searchLower) ||
      c.icd_name_en?.toLowerCase().includes(searchLower) ||
      c.code?.toLowerCase().includes(searchLower)
    );
  }, [conditions, search]);

  // Split conditions by status and sort each group by last mention date (most recent first; nulls last)
  const { activeConditions, suspectedConditions, resolvedConditions, historyConditions } = useMemo(() => {
    const sortByLastMention = (a: ConditionWithHistory, b: ConditionWithHistory) => {
      const aTime = a.last_mentioned_date ? new Date(a.last_mentioned_date).getTime() : 0;
      const bTime = b.last_mentioned_date ? new Date(b.last_mentioned_date).getTime() : 0;
      return bTime - aTime;
    };
    return {
      activeConditions: filteredConditions
        .filter(c => c.current_status === "active")
        .sort(sortByLastMention),
      suspectedConditions: filteredConditions
        .filter(c => c.current_status === "suspected")
        .sort(sortByLastMention),
      resolvedConditions: filteredConditions
        .filter(c => c.current_status === "resolved")
        .sort(sortByLastMention),
      historyConditions: filteredConditions
        .filter(c => c.current_status === "history")
        .sort(sortByLastMention),
    };
  }, [filteredConditions]);

  if (!selectedPersonId) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <p>{t("person.selectPrompt")}</p>
      </div>
    );
  }

  const renderConditionsGrid = (items: ConditionWithHistory[], isInactive = false) => (
    <div className={`grid gap-4 md:grid-cols-2 lg:grid-cols-3 min-w-0 ${isInactive ? "opacity-60" : ""}`}>
      {items.map((condition) => (
        <div key={condition.id} className="min-w-0">
          <ConditionCard condition={condition} />
        </div>
      ))}
    </div>
  );

  const renderConditionsTable = (items: ConditionWithHistory[], isInactive = false) => (
    <div className={`rounded-lg border ${isInactive ? "opacity-60" : ""}`}>
      <table className="w-full">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="text-left p-3 font-medium">{t("conditions.name")}</th>
            <th className="text-left p-3 font-medium">{t("conditions.icdName")}</th>
            <th className="text-left p-3 font-medium">{t("conditions.statusLabel")}</th>
            <th className="text-left p-3 font-medium">{t("conditions.onset")}</th>
            <th className="text-left p-3 font-medium">{t("conditions.mentions")}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((condition) => {
            return (
              <tr key={condition.id} className="border-b hover:bg-muted/30">
                <td className="p-3">
                  <Link href={`/health/conditions/${condition.id}`} className="block">
                    <div className="flex items-center gap-2">
                      <StatusIcon status={condition.current_status} />
                      <span className="font-medium hover:underline">{condition.name}</span>
                    </div>
                  </Link>
                </td>
                <td className="p-3">
                  {condition.code ? (
                    <div className="space-y-0.5">
                      <Badge variant="outline" className="font-mono text-xs">
                        {condition.code}
                      </Badge>
                      {condition.icd_name_en && (
                        <p className="text-xs text-muted-foreground truncate max-w-48">
                          {condition.icd_name_en}
                        </p>
                      )}
                    </div>
                  ) : "-"}
                </td>
                <td className="p-3">
                  <Badge variant="outline" className="text-xs">
                    {t(`conditions.status.${condition.current_status}`)}
                  </Badge>
                </td>
                <td className="p-3 text-sm text-muted-foreground">
                  {condition.onset_date 
? format(new Date(condition.onset_date), "dd.MM.yyyy", { locale: dateLocale })
                      : condition.first_mentioned_date
                      ? format(new Date(condition.first_mentioned_date), "dd.MM.yyyy", { locale: dateLocale })
                      : "-"
                  }
                </td>
                <td className="p-3 text-sm text-muted-foreground">
                  {condition.mention_count}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  const renderSection = (
    title: string,
    items: ConditionWithHistory[],
    icon: React.ReactNode,
    isInactive = false
  ) => {
    if (items.length === 0) return null;
    
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          {icon}
          {title} ({items.length})
        </h2>
        {viewMode === "cards" 
          ? renderConditionsGrid(items, isInactive)
          : renderConditionsTable(items, isInactive)
        }
      </div>
    );
  };

  return (
    <div className="space-y-6 min-w-0 overflow-x-hidden">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t("conditions.title")}</h1>
          <p className="text-muted-foreground">{t("conditions.description")}</p>
        </div>
      </div>

      {/* Status Tips */}
      <div className="rounded-lg border bg-card">
        <Button
          type="button"
          variant="ghost"
          onClick={() => setShowStatusTips(!showStatusTips)}
          className="tap-target w-full justify-between gap-2 p-3 text-sm h-auto hover:bg-muted/50 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Info className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">{t("conditions.statusTips.title")}</span>
          </div>
          {showStatusTips ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </Button>
        
        {showStatusTips && (
          <div className="px-3 pb-3 grid gap-3 sm:grid-cols-2">
            <div className="flex items-start gap-2 p-2 rounded-md bg-orange-500/5">
              <AlertCircle className="h-4 w-4 text-orange-500 mt-0.5 shrink-0" />
              <p className="text-sm">{t("conditions.statusTips.active")}</p>
            </div>
            <div className="flex items-start gap-2 p-2 rounded-md bg-yellow-500/5">
              <HelpCircle className="h-4 w-4 text-yellow-500 mt-0.5 shrink-0" />
              <p className="text-sm">{t("conditions.statusTips.suspected")}</p>
            </div>
            <div className="flex items-start gap-2 p-2 rounded-md bg-green-500/5">
              <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
              <p className="text-sm">{t("conditions.statusTips.resolved")}</p>
            </div>
            <div className="flex items-start gap-2 p-2 rounded-md bg-gray-500/5">
              <History className="h-4 w-4 text-gray-500 mt-0.5 shrink-0" />
              <p className="text-sm">{t("conditions.statusTips.history")}</p>
            </div>
          </div>
        )}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("conditions.searchPlaceholder")}
            className="pl-9"
          />
        </div>
        <div className="flex items-center border rounded-md">
          <Toggle
            pressed={viewMode === "cards"}
            onPressedChange={() => setViewMode("cards")}
            className="rounded-r-none"
            aria-label={t("conditions.cardsView")}
          >
            <LayoutGrid className="h-4 w-4" />
          </Toggle>
          <Toggle
            pressed={viewMode === "table"}
            onPressedChange={() => setViewMode("table")}
            className="rounded-l-none border-l"
            aria-label={t("conditions.tableView")}
          >
            <List className="h-4 w-4" />
          </Toggle>
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 min-w-0">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-40 min-w-0" />
          ))}
        </div>
      ) : filteredConditions && filteredConditions.length > 0 ? (
        <div className="space-y-8">
          {/* Active Conditions */}
          {renderSection(
            t("conditions.activeSection"),
            activeConditions,
            <AlertCircle className="h-5 w-5 text-orange-500" />
          )}

          {/* Suspected Conditions */}
          {renderSection(
            t("conditions.suspectedSection"),
            suspectedConditions,
            <HelpCircle className="h-5 w-5 text-yellow-500" />
          )}

          {/* Resolved Conditions */}
          {renderSection(
            t("conditions.resolvedSection"),
            resolvedConditions,
            <CheckCircle2 className="h-5 w-5 text-green-500" />,
            true
          )}

          {/* History */}
          {renderSection(
            t("conditions.historySection"),
            historyConditions,
            <History className="h-5 w-5 text-gray-500" />,
            true
          )}

          {/* No active conditions message */}
          {activeConditions.length === 0 && suspectedConditions.length === 0 && 
           (resolvedConditions.length > 0 || historyConditions.length > 0) && (
            <div className="text-center py-8 text-muted-foreground">
              <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-green-500" />
              <p>{t("conditions.allResolved")}</p>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
          <HeartPulse className="h-12 w-12 mb-4 opacity-50" />
          <p className="text-lg">{t("conditions.noConditions")}</p>
          <p className="text-sm mt-1">{t("conditions.noConditionsHint")}</p>
        </div>
      )}
    </div>
  );
}

export default function ConditionsPage() {
  return <ConditionsContent />;
}
