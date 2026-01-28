"use client";

import { useState, useMemo, useEffect } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { format } from "date-fns";
import {
  Search,
  LayoutGrid,
  Table as TableIcon,
  FlaskConical,
  ArrowUp,
  ArrowDown,
  Check,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Minus,
  Loader2,
} from "lucide-react";
import {
  LineChart,
  Line,
  ResponsiveContainer,
} from "recharts";
import { AppShell } from "@/components/layout/app-shell";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePersonObservationHistory } from "@/hooks";
import { useUIStore } from "@/stores/ui-store";
import type { ObservationSummary, ObservationStatus } from "@/types";

// Mini sparkline chart for cards
function MiniChart({ 
  data, 
  refLow, 
  refHigh 
}: { 
  data: { value: number | null; date: string }[];
  refLow?: number | null;
  refHigh?: number | null;
}) {
  const chartData = data
    .filter(d => d.value !== null)
    .map(d => ({ value: d.value }));

  if (chartData.length < 2) {
    return <div className="w-16 h-8" />;
  }

  // Determine color based on latest value and ref range
  const latestValue = chartData[chartData.length - 1]?.value;
  let strokeColor = "#6b7280"; // gray
  if (latestValue !== undefined && latestValue !== null) {
    if (refLow !== null && refLow !== undefined && latestValue < refLow) {
      strokeColor = "#3b82f6"; // blue for low
    } else if (refHigh !== null && refHigh !== undefined && latestValue > refHigh) {
      strokeColor = "#f97316"; // orange for high
    } else if (refLow !== null && refHigh !== null) {
      strokeColor = "#22c55e"; // green for normal
    }
  }

  return (
    <div className="w-16 h-8">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData}>
          <Line 
            type="monotone" 
            dataKey="value" 
            stroke={strokeColor}
            strokeWidth={1.5}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// Status badge
function StatusBadge({ status }: { status: ObservationStatus | null }) {
  const t = useTranslations();
  
  if (!status || status === "unknown") {
    return null;
  }

  const config: Record<string, { 
    variant: "default" | "destructive" | "secondary" | "outline"; 
    icon: React.ReactNode;
    className?: string;
  }> = {
    normal: { variant: "secondary", icon: <Check className="h-3 w-3" />, className: "text-green-600" },
    low: { variant: "outline", icon: <ArrowDown className="h-3 w-3" />, className: "text-blue-600 border-blue-300" },
    high: { variant: "outline", icon: <ArrowUp className="h-3 w-3" />, className: "text-orange-600 border-orange-300" },
    critical_low: { variant: "destructive", icon: <ArrowDown className="h-3 w-3" /> },
    critical_high: { variant: "destructive", icon: <ArrowUp className="h-3 w-3" /> },
  };

  const { variant, icon, className } = config[status] || { variant: "secondary", icon: null };

  return (
    <Badge variant={variant} className={`gap-1 text-xs ${className || ""}`}>
      {icon}
      {t(`observations.status.${status}`)}
    </Badge>
  );
}

// Trend indicator
function TrendIndicator({ history }: { history: { value: number | null }[] }) {
  const values = history.filter(h => h.value !== null).map(h => h.value as number);
  
  if (values.length < 2) {
    return null;
  }

  const latest = values[values.length - 1];
  const previous = values[values.length - 2];
  const diff = ((latest - previous) / previous) * 100;

  if (Math.abs(diff) < 1) {
    return <Minus className="h-4 w-4 text-muted-foreground" />;
  }

  if (diff > 0) {
    return <TrendingUp className="h-4 w-4 text-orange-500" />;
  }

  return <TrendingDown className="h-4 w-4 text-blue-500" />;
}

// Observation card component
function ObservationCard({ observation }: { observation: ObservationSummary }) {
  const t = useTranslations();
  const displayName = observation.catalog_name_ru || observation.obs_name;
  const displayValue = observation.latest_value ?? observation.latest_value_text;
  const displayUnit = observation.latest_unit || observation.canonical_unit;
  
  const chartData = observation.history.map(h => ({
    value: h.value_canonical ?? h.value_numeric,
    date: h.record_date || h.created_at,
  }));

  const isBad = observation.latest_status && 
    observation.latest_status !== "normal" && 
    observation.latest_status !== "unknown";

  return (
    <Link href={`/health/observations/${encodeURIComponent(observation.obs_code)}`}>
      <Card className={`hover:shadow-md transition-shadow cursor-pointer ${
        isBad ? "border-orange-300 dark:border-orange-700" : ""
      }`}>
        <CardContent className="p-3 sm:p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="font-medium truncate text-sm sm:text-base">{displayName}</h3>
                {isBad && <AlertTriangle className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-orange-500 shrink-0" />}
              </div>
              {observation.obs_code !== observation.obs_name && (
                <code className="text-[10px] sm:text-xs text-muted-foreground">
                  {observation.obs_code}
                </code>
              )}
            </div>
            <MiniChart 
              data={chartData} 
              refLow={observation.latest_ref_low}
              refHigh={observation.latest_ref_high}
            />
          </div>

          <div className="mt-2 sm:mt-3 flex items-end justify-between">
            <div>
              <div className="flex items-baseline gap-1">
                <span className="text-xl sm:text-2xl font-bold">
                  {typeof displayValue === "number" 
                    ? displayValue.toFixed(displayValue % 1 === 0 ? 0 : 1) 
                    : displayValue || "—"}
                </span>
                {displayUnit && (
                  <span className="text-xs sm:text-sm text-muted-foreground">{displayUnit}</span>
                )}
                <TrendIndicator history={chartData} />
              </div>
              {observation.latest_date && (
                <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5 sm:mt-1">
                  {format(new Date(observation.latest_date), "dd.MM.yyyy")}
                </p>
              )}
            </div>
            <div className="flex flex-col items-end gap-0.5 sm:gap-1">
              <StatusBadge status={observation.latest_status} />
              <span className="text-[10px] sm:text-xs text-muted-foreground">
                {observation.measurement_count} {t("observationHistory.measurements")}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

// Table view component
function ObservationsTable({ observations }: { observations: ObservationSummary[] }) {
  const t = useTranslations();

  // Flatten all observations into a table sorted by date
  const tableData = useMemo(() => {
    const rows: {
      id: string;
      obs_code: string;
      obs_name: string;
      catalog_name: string | null;
      value: number | null;
      value_text: string | null;
      unit: string | null;
      status: ObservationStatus | null;
      date: string | null;
      ref_low: number | null;
      ref_high: number | null;
    }[] = [];

    for (const obs of observations) {
      for (const point of obs.history) {
        rows.push({
          id: point.id,
          obs_code: obs.obs_code,
          obs_name: obs.obs_name,
          catalog_name: obs.catalog_name_ru,
          value: point.value_canonical ?? point.value_numeric,
          value_text: point.value_text,
          unit: point.unit_canonical || point.unit,
          status: point.status,
          date: point.record_date || point.created_at,
          ref_low: point.ref_range_low,
          ref_high: point.ref_range_high,
        });
      }
    }

    // Sort by date descending
    rows.sort((a, b) => {
      const dateA = a.date ? new Date(a.date).getTime() : 0;
      const dateB = b.date ? new Date(b.date).getTime() : 0;
      return dateB - dateA;
    });

    return rows;
  }, [observations]);

  if (tableData.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        {t("observationHistory.noData")}
      </div>
    );
  }

  return (
    <div className="rounded-md border overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left p-3 font-medium">{t("observationHistory.date")}</th>
              <th className="text-left p-3 font-medium">{t("observationHistory.observation")}</th>
              <th className="text-right p-3 font-medium">{t("observationHistory.value")}</th>
              <th className="text-left p-3 font-medium">{t("observationHistory.unit")}</th>
              <th className="text-left p-3 font-medium">{t("observationHistory.reference")}</th>
              <th className="text-left p-3 font-medium">{t("observationHistory.status")}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {tableData.map((row) => (
              <tr key={row.id} className="hover:bg-muted/30">
                <td className="p-3 whitespace-nowrap">
                  {row.date ? format(new Date(row.date), "dd.MM.yyyy") : "—"}
                </td>
                <td className="p-3">
                  <Link 
                    href={`/health/observations/${encodeURIComponent(row.obs_code)}`}
                    className="hover:underline"
                  >
                    {row.catalog_name || row.obs_name}
                  </Link>
                </td>
                <td className="p-3 text-right font-mono">
                  {row.value !== null 
                    ? row.value.toFixed(row.value % 1 === 0 ? 0 : 1)
                    : row.value_text || "—"}
                </td>
                <td className="p-3 text-muted-foreground">
                  {row.unit || "—"}
                </td>
                <td className="p-3 text-muted-foreground text-xs">
                  {row.ref_low !== null && row.ref_high !== null
                    ? `${row.ref_low}–${row.ref_high}`
                    : "—"}
                </td>
                <td className="p-3">
                  <StatusBadge status={row.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function ObservationsHistoryPage() {
  const t = useTranslations();
  const selectedPersonId = useUIStore((state) => state.selectedPersonId);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [viewMode, setViewMode] = useState<"cards" | "table">("cards");

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { data: observations, isLoading, error } = usePersonObservationHistory(
    selectedPersonId,
    debouncedSearch
  );

  return (
    <AppShell>
      <div className="space-y-6">
        {/* Header */}
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight flex items-center gap-2">
                <FlaskConical className="h-5 w-5 sm:h-6 sm:w-6 text-primary shrink-0" />
                {t("observationHistory.title")}
              </h1>
              <p className="text-sm text-muted-foreground hidden sm:block">
                {t("observationHistory.description")}
              </p>
            </div>
          </div>

          {/* View toggle */}
          <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as "cards" | "table")}>
            <TabsList className="h-9">
              <TabsTrigger value="cards" className="gap-1.5 px-2 sm:px-3">
                <LayoutGrid className="h-4 w-4" />
                <span className="hidden sm:inline">{t("observationHistory.cardsView")}</span>
              </TabsTrigger>
              <TabsTrigger value="table" className="gap-1.5 px-2 sm:px-3">
                <TableIcon className="h-4 w-4" />
                <span className="hidden sm:inline">{t("observationHistory.tableView")}</span>
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {/* Search */}
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("observationHistory.searchPlaceholder")}
            className="pl-9"
          />
        </div>

        {/* No person selected */}
        {!selectedPersonId && (
          <Card>
            <CardContent className="py-12 text-center">
              <FlaskConical className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
              <p className="text-muted-foreground">{t("person.selectPrompt")}</p>
            </CardContent>
          </Card>
        )}

        {/* Loading */}
        {selectedPersonId && isLoading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* Error */}
        {error && (
          <Card className="border-destructive">
            <CardContent className="py-8 text-center text-destructive">
              {t("common.error")}
            </CardContent>
          </Card>
        )}

        {/* Content */}
        {selectedPersonId && !isLoading && observations && (
          <>
            {observations.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <FlaskConical className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
                  <p className="text-muted-foreground">
                    {search 
                      ? t("observationHistory.noSearchResults")
                      : t("observationHistory.noData")}
                  </p>
                </CardContent>
              </Card>
            ) : viewMode === "cards" ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {observations.map((obs) => (
                  <ObservationCard key={obs.obs_code} observation={obs} />
                ))}
              </div>
            ) : (
              <ObservationsTable observations={observations} />
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
