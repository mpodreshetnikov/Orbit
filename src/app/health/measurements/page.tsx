"use client";

import { useState, useMemo, useEffect } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { format } from "date-fns";
import {
  Search,
  LayoutGrid,
  Table as TableIcon,
  Ruler,
  TrendingUp,
  TrendingDown,
  Minus,
  Loader2,
  Plus,
} from "lucide-react";
import {
  LineChart,
  Line,
  ResponsiveContainer,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePersonMeasurements } from "@/hooks";
import { useUIStore } from "@/stores/ui-store";
import type { MeasurementSummary, MeasurementCategory } from "@/types";
import { MEASUREMENT_CATEGORY_LABELS } from "@/types";
import { AddMeasurementDialog } from "@/components/measurements/add-measurement-dialog";

// Mini sparkline chart for cards
function MiniChart({ 
  data,
}: { 
  data: { value: number; date: string }[];
}) {
  const chartData = data.map(d => ({ value: d.value }));

  if (chartData.length < 2) {
    return <div className="w-16 h-8" />;
  }

  return (
    <div className="w-16 h-8">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData}>
          <Line 
            type="monotone" 
            dataKey="value" 
            stroke="hsl(var(--primary))"
            strokeWidth={1.5}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// Trend indicator
function TrendIndicator({ history }: { history: { value: number }[] }) {
  if (history.length < 2) {
    return null;
  }

  const latest = history[history.length - 1].value;
  const previous = history[history.length - 2].value;
  const diff = ((latest - previous) / previous) * 100;

  if (Math.abs(diff) < 1) {
    return <Minus className="h-4 w-4 text-muted-foreground" />;
  }

  if (diff > 0) {
    return <TrendingUp className="h-4 w-4 text-orange-500" />;
  }

  return <TrendingDown className="h-4 w-4 text-blue-500" />;
}

// Measurement card component
function MeasurementCard({ measurement, locale }: { measurement: MeasurementSummary; locale: string }) {
  const t = useTranslations();
  const displayName = locale === "ru" ? measurement.name_ru : measurement.name_en;
  const displayUnit = locale === "ru" ? measurement.unit_ru : measurement.unit_en;
  
  const chartData = measurement.history.map(h => ({
    value: h.value,
    date: h.measured_at,
  }));

  return (
    <Link href={`/health/measurements/${encodeURIComponent(measurement.code)}`}>
      <Card className="hover:shadow-md transition-shadow cursor-pointer">
        <CardContent className="p-3 sm:p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <h3 className="font-medium truncate text-sm sm:text-base">{displayName}</h3>
              <Badge variant="outline" className="text-[10px] sm:text-xs mt-1 px-1.5 py-0">
                {t(`measurements.categories.${measurement.category}`)}
              </Badge>
            </div>
            <MiniChart data={chartData} />
          </div>

          <div className="mt-2 sm:mt-3 flex items-end justify-between">
            <div>
              <div className="flex items-baseline gap-1">
                <span className="text-xl sm:text-2xl font-bold">
                  {measurement.latest_value.toFixed(
                    measurement.latest_value % 1 === 0 ? 0 : 1
                  )}
                </span>
                {displayUnit && (
                  <span className="text-xs sm:text-sm text-muted-foreground">{displayUnit}</span>
                )}
                <TrendIndicator history={chartData} />
              </div>
              {measurement.latest_date && (
                <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5 sm:mt-1">
                  {format(new Date(measurement.latest_date), "dd.MM.yyyy")}
                </p>
              )}
            </div>
            <span className="text-[10px] sm:text-xs text-muted-foreground">
              {measurement.measurement_count} {t("measurements.measurements")}
            </span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

// Table view component
function MeasurementsTable({ measurements, locale }: { measurements: MeasurementSummary[]; locale: string }) {
  const t = useTranslations();

  // Flatten all measurements into a table sorted by date
  const tableData = useMemo(() => {
    const rows: {
      id: string;
      code: string;
      name: string;
      value: number;
      unit: string;
      date: string;
      category: MeasurementCategory;
    }[] = [];

    for (const m of measurements) {
      for (const point of m.history) {
        rows.push({
          id: point.id,
          code: m.code,
          name: locale === "ru" ? m.name_ru : m.name_en,
          value: point.value,
          unit: locale === "ru" ? m.unit_ru : m.unit_en,
          date: point.measured_at,
          category: m.category,
        });
      }
    }

    // Sort by date descending
    rows.sort((a, b) => {
      const dateA = new Date(a.date).getTime();
      const dateB = new Date(b.date).getTime();
      return dateB - dateA;
    });

    return rows;
  }, [measurements, locale]);

  if (tableData.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        {t("measurements.noData")}
      </div>
    );
  }

  return (
    <div className="rounded-md border overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left p-3 font-medium">{t("measurements.date")}</th>
              <th className="text-left p-3 font-medium">{t("measurements.measurement")}</th>
              <th className="text-right p-3 font-medium">{t("measurements.value")}</th>
              <th className="text-left p-3 font-medium">{t("measurements.unit")}</th>
              <th className="text-left p-3 font-medium">{t("measurements.category")}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {tableData.map((row) => (
              <tr key={row.id} className="hover:bg-muted/30">
                <td className="p-3 whitespace-nowrap">
                  {format(new Date(row.date), "dd.MM.yyyy HH:mm")}
                </td>
                <td className="p-3">
                  <Link 
                    href={`/health/measurements/${encodeURIComponent(row.code)}`}
                    className="hover:underline"
                  >
                    {row.name}
                  </Link>
                </td>
                <td className="p-3 text-right font-mono">
                  {row.value.toFixed(row.value % 1 === 0 ? 0 : 1)}
                </td>
                <td className="p-3 text-muted-foreground">
                  {row.unit || "—"}
                </td>
                <td className="p-3">
                  <Badge variant="outline" className="text-xs">
                    {t(`measurements.categories.${row.category}`)}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function MeasurementsPage() {
  const t = useTranslations();
  const selectedPersonId = useUIStore((state) => state.selectedPersonId);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [viewMode, setViewMode] = useState<"cards" | "table">("cards");
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [locale, setLocale] = useState("en");

  // Get locale from document
  useEffect(() => {
    const htmlLang = document.documentElement.lang || "en";
    setLocale(htmlLang);
  }, []);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { data: measurements, isLoading, error } = usePersonMeasurements(
    selectedPersonId,
    debouncedSearch
  );

  // Group measurements by category for card view
  const groupedMeasurements = useMemo((): Record<MeasurementCategory, MeasurementSummary[]> => {
    const groups: Record<MeasurementCategory, MeasurementSummary[]> = {
      basic: [],
      body: [],
      limbs: [],
      vital: [],
    };
    
    if (!measurements) return groups;

    for (const m of measurements) {
      if (groups[m.category]) {
        groups[m.category].push(m);
      }
    }

    return groups;
  }, [measurements]);

  return (
    <>
      <div className="space-y-6">
        {/* Header */}
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight flex items-center gap-2">
                <Ruler className="h-5 w-5 sm:h-6 sm:w-6 text-primary shrink-0" />
                {t("measurements.title")}
              </h1>
              <p className="text-sm text-muted-foreground hidden sm:block">
                {t("measurements.description")}
              </p>
            </div>

            {/* Add button */}
            <Button onClick={() => setAddDialogOpen(true)} size="sm" className="gap-1 shrink-0">
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">{t("measurements.addMeasurement")}</span>
              <span className="sm:hidden">{t("common.add")}</span>
            </Button>
          </div>

          {/* View toggle - scrollable on mobile */}
          <div className="flex items-center justify-between gap-2">
            <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as "cards" | "table")}>
              <TabsList className="h-9">
                <TabsTrigger value="cards" className="gap-1.5 px-2 sm:px-3">
                  <LayoutGrid className="h-4 w-4" />
                  <span className="hidden sm:inline">{t("measurements.cardsView")}</span>
                </TabsTrigger>
                <TabsTrigger value="table" className="gap-1.5 px-2 sm:px-3">
                  <TableIcon className="h-4 w-4" />
                  <span className="hidden sm:inline">{t("measurements.tableView")}</span>
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </div>

        {/* Search */}
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("measurements.searchPlaceholder")}
            className="pl-9"
          />
        </div>

        {/* No person selected */}
        {!selectedPersonId && (
          <Card>
            <CardContent className="py-12 text-center">
              <Ruler className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
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
        {selectedPersonId && !isLoading && measurements && (
          <>
            {measurements.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <Ruler className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
                  <p className="text-muted-foreground">
                    {search 
                      ? t("measurements.noSearchResults")
                      : t("measurements.noData")}
                  </p>
                  {!search && (
                    <Button 
                      onClick={() => setAddDialogOpen(true)} 
                      variant="outline" 
                      className="mt-4"
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      {t("measurements.addFirst")}
                    </Button>
                  )}
                </CardContent>
              </Card>
            ) : viewMode === "cards" ? (
              <div className="space-y-8">
                {Object.entries(groupedMeasurements).map(([category, items]) => {
                  if (items.length === 0) return null;
                  const categoryLabel = MEASUREMENT_CATEGORY_LABELS[category as MeasurementCategory];
                  return (
                    <div key={category}>
                      <h2 className="text-lg font-semibold mb-4">
                        {locale === "ru" ? categoryLabel.ru : categoryLabel.en}
                      </h2>
                      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                        {items.map((m) => (
                          <MeasurementCard key={m.code} measurement={m} locale={locale} />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <MeasurementsTable measurements={measurements} locale={locale} />
            )}
          </>
        )}
      </div>

      {/* Add Measurement Dialog */}
      <AddMeasurementDialog 
        open={addDialogOpen} 
        onOpenChange={setAddDialogOpen}
        personId={selectedPersonId}
      />
    </>
  );
}
