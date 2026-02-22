"use client";

import React from "react";
import { use, useState, useMemo, useEffect } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import type { Locale } from "date-fns";
import { useDateFnsLocale } from "@/lib/date-locale";
import {
  ArrowLeft,
  Ruler,
  TrendingUp,
  TrendingDown,
  Loader2,
  Calendar,
  Trash2,
  Edit2,
  Plus,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useSingleMeasurementHistory, useDeleteMeasurement } from "@/hooks";
import { useUIStore } from "@/stores/ui-store";
import type { MeasurementHistoryPoint } from "@/types";
import { AddMeasurementDialog } from "@/components/measurements/add-measurement-dialog";
import { EditMeasurementDialog } from "@/components/measurements/edit-measurement-dialog";

// Custom tooltip for chart
function CustomTooltip({
  active,
  payload,
  label,
  unit,
}: {
  active?: boolean;
  payload?: { value: number }[];
  label?: string;
  unit?: string;
}) {
  if (!active || !payload || !payload.length) {
    return null;
  }

  return (
    <div className="rounded-lg border bg-background p-3 shadow-md">
      <p className="text-sm text-muted-foreground mb-1">{label}</p>
      <p className="text-lg font-semibold">
        {payload[0].value.toFixed(payload[0].value % 1 === 0 ? 0 : 2)}
        {unit && <span className="text-sm font-normal ml-1">{unit}</span>}
      </p>
    </div>
  );
}

// Main chart component
function MeasurementChart({
  history,
  unit,
  dateLocale,
}: {
  history: MeasurementHistoryPoint[];
  unit?: string;
  dateLocale: Locale;
}) {
  const chartData = history
    .filter((h) => h.value !== null)
    .map((h) => ({
      date: format(new Date(h.measured_at), "dd.MM.yy", { locale: dateLocale }),
      value: h.value,
    }));

  if (chartData.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center text-muted-foreground">
        No data to display
      </div>
    );
  }

  // Calculate Y axis domain
  const values = chartData.map((d) => d.value);
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const padding = (maxVal - minVal) * 0.1 || 1;
  const yMin = Math.max(0, minVal - padding);
  const yMax = maxVal + padding;

  return (
    <div
      className="w-full min-w-0 h-52 sm:h-72 md:h-80 [&_*]:outline-none [&_*]:focus:outline-none [&_*]:focus-visible:outline-none [&_*]:focus:ring-0 [&_*]:focus-visible:ring-0"
      style={{ minHeight: 208 }}
    >
      <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={208}>
        <LineChart data={chartData} margin={{ top: 8, right: 8, left: 4, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
          <YAxis
            domain={[yMin, yMax]}
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={36}
            tickFormatter={(v) => v.toFixed(v % 1 === 0 ? 0 : 1)}
          />
          <Tooltip content={<CustomTooltip unit={unit} />} />
          <Line
            type="monotone"
            dataKey="value"
            stroke="hsl(var(--primary))"
            strokeWidth={2}
            dot={{ fill: "hsl(var(--primary))", strokeWidth: 2, r: 4 }}
            activeDot={{ r: 8, fill: "hsl(var(--primary))" }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// History table
function HistoryTable({
  history,
  unit,
  dateLocale,
  onEdit,
  onDelete,
}: {
  history: MeasurementHistoryPoint[];
  unit?: string;
  dateLocale: Locale;
  onEdit: (point: MeasurementHistoryPoint) => void;
  onDelete: (point: MeasurementHistoryPoint) => void;
}) {
  const t = useTranslations();

  // Sort by date descending for table
  const sortedHistory = [...history].sort((a, b) => {
    return new Date(b.measured_at).getTime() - new Date(a.measured_at).getTime();
  });

  return (
    <div className="rounded-md border overflow-x-auto">
      <table className="w-full text-sm min-w-[420px]">
        <thead className="bg-muted/50">
          <tr>
            <th className="text-left p-2 sm:p-3 font-medium">{t("measurements.date")}</th>
            <th className="text-right p-2 sm:p-3 font-medium">{t("measurements.value")}</th>
            <th className="text-left p-2 sm:p-3 font-medium">{t("measurements.notes")}</th>
            <th className="p-2 sm:p-3 w-20 sm:w-24"></th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {sortedHistory.map((point) => (
            <tr key={point.id} className="hover:bg-muted/30">
              <td className="p-2 sm:p-3 whitespace-nowrap">
                <div className="flex items-center gap-1.5 sm:gap-2">
                  <Calendar className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground shrink-0" />
                  {format(new Date(point.measured_at), "dd MMM yyyy, HH:mm", {
                    locale: dateLocale,
                  })}
                </div>
              </td>
              <td className="p-2 sm:p-3 text-right whitespace-nowrap">
                <span className="font-mono font-semibold">
                  {point.value.toFixed(point.value % 1 === 0 ? 0 : 2)}
                </span>
                {unit && <span className="text-muted-foreground ml-1">{unit}</span>}
              </td>
              <td className="p-2 sm:p-3 text-muted-foreground max-w-xs truncate">
                {point.notes || "—"}
              </td>
              <td className="p-2 sm:p-3">
                <div className="flex items-center gap-1 justify-end">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 sm:h-8 sm:w-8"
                    onClick={() => onEdit(point)}
                  >
                    <Edit2 className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 sm:h-8 sm:w-8 text-destructive hover:text-destructive"
                    onClick={() => onDelete(point)}
                  >
                    <Trash2 className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function MeasurementDetailPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const decodedCode = decodeURIComponent(code);
  const t = useTranslations();
  const router = useRouter();
  const dateLocale = useDateFnsLocale();
  const selectedPersonId = useUIStore((state) => state.selectedPersonId);
  const [locale, setLocale] = useState("en");
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingPoint, setEditingPoint] = useState<MeasurementHistoryPoint | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingPoint, setDeletingPoint] = useState<MeasurementHistoryPoint | null>(null);

  // Get locale from document
  useEffect(() => {
    const htmlLang = document.documentElement.lang || "en";
    setLocale(htmlLang);
  }, []);

  const {
    data: measurement,
    isLoading,
    error,
  } = useSingleMeasurementHistory(selectedPersonId, decodedCode);

  const deleteMutation = useDeleteMeasurement();

  const displayName = locale === "ru" ? measurement?.name_ru : measurement?.name_en;
  const displayUnit = locale === "ru" ? measurement?.unit_ru : measurement?.unit_en;

  // Calculate trend
  const trend = useMemo(() => {
    if (!measurement || measurement.history.length < 2) return null;

    const values = measurement.history.map((h) => h.value);
    const latest = values[values.length - 1];
    const previous = values[values.length - 2];
    const diff = ((latest - previous) / previous) * 100;

    if (Math.abs(diff) < 1) return { direction: "stable" as const, percent: 0 };
    return {
      direction: diff > 0 ? ("up" as const) : ("down" as const),
      percent: Math.abs(diff),
    };
  }, [measurement]);

  const handleEdit = (point: MeasurementHistoryPoint) => {
    setEditingPoint(point);
    setEditDialogOpen(true);
  };

  const handleDeleteClick = (point: MeasurementHistoryPoint) => {
    setDeletingPoint(point);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!deletingPoint || !selectedPersonId) return;

    try {
      await deleteMutation.mutateAsync({
        id: deletingPoint.id,
        personId: selectedPersonId,
      });
      setDeleteDialogOpen(false);
      setDeletingPoint(null);
    } catch (error) {
      console.error("Failed to delete measurement:", error);
    }
  };

  return (
    <>
      <div className="space-y-3 sm:space-y-6">
        {/* Header */}
        <div className="flex items-start gap-2 sm:gap-4">
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 sm:h-10 sm:w-10 shrink-0"
            onClick={() => router.back()}
          >
            <ArrowLeft className="h-4 w-4 sm:h-5 sm:w-5" />
          </Button>
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 mb-0.5">
              <Ruler className="h-4 w-4 sm:h-5 sm:w-5 text-primary shrink-0" />
              <Badge variant="outline" className="text-xs">
                {decodedCode}
              </Badge>
            </div>
            <h1 className="text-lg sm:text-2xl font-bold tracking-tight truncate">
              {displayName || decodedCode}
            </h1>
          </div>
          <Button
            onClick={() => setAddDialogOpen(true)}
            size="sm"
            className="gap-1 shrink-0 h-8 sm:h-9 text-xs sm:text-sm"
          >
            <Plus className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            <span className="hidden sm:inline">{t("measurements.addMeasurement")}</span>
          </Button>
        </div>

        {/* Loading */}
        {isLoading && (
          <div className="flex items-center justify-center py-6 sm:py-12">
            <Loader2 className="h-6 w-6 sm:h-8 sm:w-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* Error */}
        {error && (
          <Card className="border-destructive">
            <CardContent className="py-6 sm:py-8 text-center text-destructive text-sm sm:text-base">
              {t("common.error")}
            </CardContent>
          </Card>
        )}

        {/* Not found */}
        {!isLoading && !error && !measurement && (
          <Card>
            <CardContent className="py-6 sm:py-12 text-center">
              <Ruler className="h-10 w-10 sm:h-12 sm:w-12 mx-auto mb-3 sm:mb-4 text-muted-foreground opacity-50" />
              <p className="text-sm sm:text-base text-muted-foreground">
                {t("measurements.noData")}
              </p>
            </CardContent>
          </Card>
        )}

        {/* Content */}
        {measurement && (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-4">
              {/* Latest value */}
              <Card className="overflow-hidden">
                <CardHeader className="p-3 sm:p-6 sm:pb-2">
                  <CardTitle className="text-xs sm:text-sm font-medium text-muted-foreground">
                    {t("measurements.latestValue")}
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-3 pt-0 sm:p-6 sm:pt-0">
                  <div className="flex items-baseline gap-1 sm:gap-2 flex-wrap">
                    <span className="text-xl sm:text-3xl font-bold">
                      {measurement.latest_value.toFixed(measurement.latest_value % 1 === 0 ? 0 : 1)}
                    </span>
                    {displayUnit && (
                      <span className="text-muted-foreground text-sm sm:text-base">
                        {displayUnit}
                      </span>
                    )}
                  </div>
                  {measurement.latest_date && (
                    <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5 sm:mt-1">
                      {format(new Date(measurement.latest_date), "dd MMM yyyy", {
                        locale: dateLocale,
                      })}
                    </p>
                  )}
                </CardContent>
              </Card>

              {/* Trend */}
              <Card className="overflow-hidden">
                <CardHeader className="p-3 sm:p-6 sm:pb-2">
                  <CardTitle className="text-xs sm:text-sm font-medium text-muted-foreground">
                    {t("measurements.trend")}
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-3 pt-0 sm:p-6 sm:pt-0">
                  {trend ? (
                    <div className="flex items-center gap-1.5 sm:gap-2">
                      {trend.direction === "up" && (
                        <>
                          <TrendingUp className="h-4 w-4 sm:h-5 sm:w-5 text-orange-500 shrink-0" />
                          <span className="text-sm sm:text-lg font-semibold text-orange-500">
                            +{trend.percent.toFixed(1)}%
                          </span>
                        </>
                      )}
                      {trend.direction === "down" && (
                        <>
                          <TrendingDown className="h-4 w-4 sm:h-5 sm:w-5 text-blue-500 shrink-0" />
                          <span className="text-sm sm:text-lg font-semibold text-blue-500">
                            -{trend.percent.toFixed(1)}%
                          </span>
                        </>
                      )}
                      {trend.direction === "stable" && (
                        <span className="text-muted-foreground text-sm sm:text-base">
                          {t("measurements.stable")}
                        </span>
                      )}
                    </div>
                  ) : (
                    <span className="text-muted-foreground text-sm">—</span>
                  )}
                </CardContent>
              </Card>

              {/* Total measurements */}
              <Card className="overflow-hidden">
                <CardHeader className="p-3 sm:p-6 sm:pb-2">
                  <CardTitle className="text-xs sm:text-sm font-medium text-muted-foreground">
                    {t("measurements.totalMeasurements")}
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-3 pt-0 sm:p-6 sm:pt-0">
                  <span className="text-xl sm:text-3xl font-bold">
                    {measurement.measurement_count}
                  </span>
                </CardContent>
              </Card>

              {/* Category */}
              <Card className="overflow-hidden">
                <CardHeader className="p-3 sm:p-6 sm:pb-2">
                  <CardTitle className="text-xs sm:text-sm font-medium text-muted-foreground">
                    {t("measurements.category")}
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-3 pt-0 sm:p-6 sm:pt-0">
                  <Badge variant="outline" className="text-xs">
                    {t(`measurements.categories.${measurement.category}`)}
                  </Badge>
                </CardContent>
              </Card>
            </div>

            {/* Chart */}
            {measurement.history.length > 0 && (
              <Card>
                <CardHeader className="p-3 sm:p-6">
                  <CardTitle className="text-sm sm:text-base">
                    {t("measurements.chartTitle")}
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-3 sm:p-6 pt-0">
                  <MeasurementChart
                    history={measurement.history}
                    unit={displayUnit}
                    dateLocale={dateLocale}
                  />
                </CardContent>
              </Card>
            )}

            {/* History table */}
            {measurement.history.length > 0 && (
              <Card>
                <CardHeader className="p-3 sm:p-6">
                  <CardTitle className="text-sm sm:text-base">
                    {t("measurements.historyTitle")}
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0 sm:p-6 pt-0">
                  <div className="overflow-x-auto">
                    <HistoryTable
                      history={measurement.history}
                      unit={displayUnit}
                      dateLocale={dateLocale}
                      onEdit={handleEdit}
                      onDelete={handleDeleteClick}
                    />
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Empty state */}
            {measurement.history.length === 0 && (
              <Card>
                <CardContent className="py-6 sm:py-12 text-center">
                  <Ruler className="h-10 w-10 sm:h-12 sm:w-12 mx-auto mb-3 sm:mb-4 text-muted-foreground opacity-50" />
                  <p className="text-sm sm:text-base text-muted-foreground mb-3 sm:mb-4">
                    {t("measurements.noData")}
                  </p>
                  <Button
                    onClick={() => setAddDialogOpen(true)}
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                  >
                    <Plus className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                    {t("measurements.addFirst")}
                  </Button>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>

      {/* Add Measurement Dialog */}
      <AddMeasurementDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        personId={selectedPersonId}
        preselectedCode={decodedCode}
      />

      {/* Edit Measurement Dialog */}
      <EditMeasurementDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        personId={selectedPersonId}
        measurement={editingPoint}
        catalogId={measurement?.catalog_id}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("measurements.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("measurements.deleteMessage")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
