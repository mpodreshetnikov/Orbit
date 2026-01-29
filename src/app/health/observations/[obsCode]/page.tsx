"use client";

import { use, useState, useMemo } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import {
  ArrowLeft,
  FlaskConical,
  ArrowUp,
  ArrowDown,
  Check,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Loader2,
  Calendar,
  ExternalLink,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  ReferenceArea,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSingleObservationHistory, useObservationCatalog } from "@/hooks";
import { useUIStore } from "@/stores/ui-store";
import type { ObservationStatus, ObservationHistoryPoint } from "@/types";
import Link from "next/link";

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
    <Badge variant={variant} className={`gap-1 ${className || ""}`}>
      {icon}
      {t(`observations.status.${status}`)}
    </Badge>
  );
}

// Custom tooltip for chart
function CustomTooltip({ 
  active, 
  payload, 
  label,
  unit,
}: { 
  active?: boolean; 
  payload?: { value: number; payload?: { hasDuplicate?: boolean; duplicateCount?: number } }[];
  label?: string;
  unit?: string;
}) {
  if (!active || !payload || !payload.length) {
    return null;
  }

  const dataPoint = payload[0].payload;
  const hasDuplicate = dataPoint?.hasDuplicate;
  const duplicateCount = dataPoint?.duplicateCount || 0;

  return (
    <div className="rounded-lg border bg-background p-3 shadow-md">
      <p className="text-sm text-muted-foreground mb-1">{label}</p>
      <p className="text-lg font-semibold">
        {payload[0].value.toFixed(payload[0].value % 1 === 0 ? 0 : 2)}
        {unit && <span className="text-sm font-normal ml-1">{unit}</span>}
      </p>
      {hasDuplicate && (
        <p className="text-xs text-orange-500 mt-1 flex items-center gap-1">
          <AlertTriangle className="h-3 w-3" />
          {duplicateCount} measurements on this day
        </p>
      )}
    </div>
  );
}

// Custom dot renderer for chart with duplicate warning
function CustomDot(props: {
  cx?: number;
  cy?: number;
  payload?: { hasDuplicate?: boolean };
}) {
  const { cx, cy, payload } = props;
  if (cx === undefined || cy === undefined) return null;

  const hasDuplicate = payload?.hasDuplicate;

  return (
    <g>
      <circle
        cx={cx}
        cy={cy}
        r={hasDuplicate ? 6 : 4}
        fill={hasDuplicate ? "#f97316" : "hsl(var(--primary))"}
        stroke={hasDuplicate ? "#ea580c" : "hsl(var(--primary))"}
        strokeWidth={2}
      />
      {hasDuplicate && (
        <text
          x={cx}
          y={cy - 10}
          textAnchor="middle"
          fill="#f97316"
          fontSize={10}
          fontWeight="bold"
        >
          !
        </text>
      )}
    </g>
  );
}

// Main chart component
function ObservationChart({ 
  history, 
  unit,
  refLow,
  refHigh,
}: { 
  history: ObservationHistoryPoint[];
  unit?: string | null;
  refLow?: number | null;
  refHigh?: number | null;
}) {
  // Group by date and take last value, mark duplicates
  const dateMap = new Map<string, { 
    values: { value: number; status: ObservationStatus | null }[];
    dateKey: string;
  }>();
  
  history
    .filter(h => (h.value_canonical ?? h.value_numeric) !== null)
    .forEach(h => {
      const dateKey = h.record_date 
        ? format(new Date(h.record_date), "dd.MM.yy")
        : format(new Date(h.created_at), "dd.MM.yy");
      
      if (!dateMap.has(dateKey)) {
        dateMap.set(dateKey, { values: [], dateKey });
      }
      dateMap.get(dateKey)!.values.push({
        value: (h.value_canonical ?? h.value_numeric) as number,
        status: h.status,
      });
    });

  const chartData = Array.from(dateMap.entries())
    .sort((a, b) => {
      // Sort by date
      const [dayA, monthA, yearA] = a[0].split(".").map(Number);
      const [dayB, monthB, yearB] = b[0].split(".").map(Number);
      const dateA = new Date(2000 + yearA, monthA - 1, dayA);
      const dateB = new Date(2000 + yearB, monthB - 1, dayB);
      return dateA.getTime() - dateB.getTime();
    })
    .map(([date, data]) => ({
      date,
      value: data.values[data.values.length - 1].value, // Take last value
      status: data.values[data.values.length - 1].status,
      hasDuplicate: data.values.length > 1,
      duplicateCount: data.values.length,
    }));

  if (chartData.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center text-muted-foreground">
        No data to display
      </div>
    );
  }

  // Calculate Y axis domain
  const values = chartData.map(d => d.value as number);
  let minVal = Math.min(...values);
  let maxVal = Math.max(...values);
  
  // Include ref range in domain if present
  if (refLow !== null && refLow !== undefined) {
    minVal = Math.min(minVal, refLow);
  }
  if (refHigh !== null && refHigh !== undefined) {
    maxVal = Math.max(maxVal, refHigh);
  }

  // Add some padding
  const padding = (maxVal - minVal) * 0.1 || 1;
  const yMin = Math.max(0, minVal - padding);
  const yMax = maxVal + padding;

  return (
    <div className="h-80">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
          <XAxis 
            dataKey="date" 
            tick={{ fontSize: 12 }}
            tickLine={false}
          />
          <YAxis 
            domain={[yMin, yMax]}
            tick={{ fontSize: 12 }}
            tickLine={false}
            axisLine={false}
            width={60}
            tickFormatter={(v) => v.toFixed(v % 1 === 0 ? 0 : 1)}
          />
          <Tooltip content={<CustomTooltip unit={unit || undefined} />} />
          
          {/* Reference range area */}
          {refLow !== null && refHigh !== null && (
            <ReferenceArea
              y1={refLow}
              y2={refHigh}
              fill="#22c55e"
              fillOpacity={0.1}
              stroke="#22c55e"
              strokeOpacity={0.3}
              strokeDasharray="3 3"
            />
          )}
          
          {/* Reference lines */}
          {refLow !== null && (
            <ReferenceLine 
              y={refLow} 
              stroke="#22c55e" 
              strokeDasharray="5 5"
              label={{ value: `Low: ${refLow}`, position: "left", fontSize: 10 }}
            />
          )}
          {refHigh !== null && (
            <ReferenceLine 
              y={refHigh} 
              stroke="#22c55e" 
              strokeDasharray="5 5"
              label={{ value: `High: ${refHigh}`, position: "left", fontSize: 10 }}
            />
          )}

          <Line 
            type="monotone" 
            dataKey="value" 
            stroke="hsl(var(--primary))"
            strokeWidth={2}
            dot={<CustomDot />}
            activeDot={{ 
              r: 8, 
              fill: "hsl(var(--primary))",
            }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// History table
function HistoryTable({ 
  history, 
  unit 
}: { 
  history: ObservationHistoryPoint[];
  unit?: string | null;
}) {
  const t = useTranslations();

  // Sort by date descending for table
  const sortedHistory = [...history].sort((a, b) => {
    const dateA = new Date(a.record_date || a.created_at).getTime();
    const dateB = new Date(b.record_date || b.created_at).getTime();
    return dateB - dateA;
  });

  return (
    <div className="rounded-md border overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            <th className="text-left p-3 font-medium">{t("observationHistory.date")}</th>
            <th className="text-right p-3 font-medium">{t("observationHistory.value")}</th>
            <th className="text-left p-3 font-medium">{t("observationHistory.reference")}</th>
            <th className="text-left p-3 font-medium">{t("observationHistory.status")}</th>
            <th className="p-3"></th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {sortedHistory.map((point) => {
            const value = point.value_canonical ?? point.value_numeric;
            return (
              <tr key={point.id} className="hover:bg-muted/30">
                <td className="p-3 whitespace-nowrap">
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    {point.record_date 
                      ? format(new Date(point.record_date), "dd MMMM yyyy")
                      : format(new Date(point.created_at), "dd MMMM yyyy")}
                  </div>
                </td>
                <td className="p-3 text-right">
                  <span className="font-mono font-semibold">
                    {value !== null 
                      ? value.toFixed(value % 1 === 0 ? 0 : 2)
                      : point.value_text || "—"}
                  </span>
                  {unit && (
                    <span className="text-muted-foreground ml-1">{unit}</span>
                  )}
                </td>
                <td className="p-3 text-muted-foreground">
                  {point.ref_range_low !== null && point.ref_range_high !== null
                    ? `${point.ref_range_low}–${point.ref_range_high}`
                    : "—"}
                </td>
                <td className="p-3">
                  <StatusBadge status={point.status} />
                </td>
                <td className="p-3">
                  <Link href={`/health/records/${point.record_id}`}>
                    <Button variant="ghost" size="icon" className="h-8 w-8">
                      <ExternalLink className="h-4 w-4" />
                    </Button>
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Unit conversion utilities
function convertFromCanonical(
  canonicalValue: number | null,
  targetUnit: string,
  acceptedUnits: Record<string, { factor_to_canonical?: number; formula_to_canonical?: string }> | null
): number | null {
  if (canonicalValue === null || !acceptedUnits || !acceptedUnits[targetUnit]) {
    return canonicalValue;
  }
  
  const config = acceptedUnits[targetUnit];
  
  // For factor-based conversion, divide to go from canonical to target
  if (config.factor_to_canonical !== undefined && config.factor_to_canonical !== 0) {
    return canonicalValue / config.factor_to_canonical;
  }
  
  // Formula-based conversion would need inverse formula - skip for now
  return canonicalValue;
}

export default function ObservationDetailPage({ 
  params 
}: { 
  params: Promise<{ obsCode: string }> 
}) {
  const { obsCode } = use(params);
  const decodedObsCode = decodeURIComponent(obsCode);
  const t = useTranslations();
  const router = useRouter();
  const selectedPersonId = useUIStore((state) => state.selectedPersonId);

  const { data: observation, isLoading, error } = useSingleObservationHistory(
    selectedPersonId,
    decodedObsCode
  );
  
  const { data: catalog } = useObservationCatalog();
  
  // Find catalog entry for this observation
  const catalogEntry = useMemo(() => {
    if (!catalog || !observation?.catalog_id) return null;
    return catalog.find(c => c.id === observation.catalog_id) || null;
  }, [catalog, observation?.catalog_id]);
  
  // Available units from catalog
  const availableUnits = useMemo(() => {
    if (!catalogEntry?.accepted_units) return [];
    return Object.keys(catalogEntry.accepted_units);
  }, [catalogEntry]);
  
  // State for selected display unit (default to canonical)
  const canonicalUnit = observation?.canonical_unit || observation?.latest_unit || "";
  const [selectedUnit, setSelectedUnit] = useState<string>("");
  
  // Use canonical unit as default when observation loads
  const displayUnit = selectedUnit || canonicalUnit;
  
  // Convert a value for display in the selected unit
  const convertValue = useMemo(() => {
    return (canonicalValue: number | null): number | null => {
      if (!selectedUnit || selectedUnit === canonicalUnit || !catalogEntry?.accepted_units) {
        return canonicalValue;
      }
      return convertFromCanonical(canonicalValue, selectedUnit, catalogEntry.accepted_units);
    };
  }, [selectedUnit, canonicalUnit, catalogEntry]);

  const displayName = observation?.catalog_name_ru || observation?.obs_name || decodedObsCode;
  const latestValue = convertValue(observation?.latest_value ?? null);
  
  // Convert ref ranges for display (use specific ref range first, then fall back to default)
  const displayRefLow = convertValue(
    observation?.latest_ref_low_canonical ?? 
    observation?.latest_ref_low ?? 
    observation?.default_ref_low ?? 
    null
  );
  const displayRefHigh = convertValue(
    observation?.latest_ref_high_canonical ?? 
    observation?.latest_ref_high ?? 
    observation?.default_ref_high ?? 
    null
  );

  // Calculate trend
  const trend = (() => {
    if (!observation || observation.history.length < 2) return null;
    const values = observation.history
      .filter(h => (h.value_canonical ?? h.value_numeric) !== null)
      .map(h => convertValue(h.value_canonical ?? h.value_numeric))
      .filter((v): v is number => v !== null);
    
    if (values.length < 2) return null;
    
    const latest = values[values.length - 1];
    const previous = values[values.length - 2];
    const diff = ((latest - previous) / previous) * 100;
    
    if (Math.abs(diff) < 1) return { direction: "stable" as const, percent: 0 };
    return { 
      direction: diff > 0 ? "up" as const : "down" as const, 
      percent: Math.abs(diff) 
    };
  })();
  
  // Convert history for chart and table
  const convertedHistory = useMemo(() => {
    if (!observation) return [];
    return observation.history.map(h => ({
      ...h,
      value_canonical: convertValue(h.value_canonical ?? h.value_numeric),
      ref_range_low: convertValue(h.ref_range_low_canonical ?? h.ref_range_low),
      ref_range_high: convertValue(h.ref_range_high_canonical ?? h.ref_range_high),
    }));
  }, [observation, convertValue]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <FlaskConical className="h-5 w-5 text-primary" />
            <Badge variant="outline">{decodedObsCode}</Badge>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">{displayName}</h1>
        </div>
        {/* Unit selector */}
        {availableUnits.length > 1 && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">{t("observations.displayUnit")}:</span>
            <Select 
              value={selectedUnit || canonicalUnit} 
              onValueChange={setSelectedUnit}
            >
              <SelectTrigger className="w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {availableUnits.map((u) => (
                  <SelectItem key={u} value={u}>
                    {u}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {/* Loading */}
      {isLoading && (
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

      {/* Not found */}
      {!isLoading && !error && !observation && (
        <Card>
          <CardContent className="py-12 text-center">
            <FlaskConical className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
            <p className="text-muted-foreground">{t("observationHistory.noData")}</p>
          </CardContent>
        </Card>
      )}

      {/* Content */}
      {observation && (
        <>
          {/* Summary cards */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {/* Latest value */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {t("observationHistory.latestValue")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-bold">
                    {latestValue !== null && latestValue !== undefined
                      ? latestValue.toFixed(latestValue % 1 === 0 ? 0 : 1)
                      : observation.latest_value_text || "—"}
                  </span>
                  {displayUnit && (
                    <span className="text-muted-foreground">{displayUnit}</span>
                  )}
                </div>
                {observation.latest_date && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {format(new Date(observation.latest_date), "dd MMMM yyyy")}
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Status */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {t("observationHistory.status")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <StatusBadge status={observation.latest_status} />
                {observation.latest_status && 
                 observation.latest_status !== "normal" && 
                 observation.latest_status !== "unknown" && (
                  <div className="flex items-center gap-1 mt-2 text-orange-600">
                    <AlertTriangle className="h-4 w-4" />
                    <span className="text-sm">{t("observationHistory.outOfRange")}</span>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Reference range */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {t("observationHistory.referenceRange")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {displayRefLow !== null && displayRefHigh !== null ? (
                  <div className="text-lg font-semibold">
                    {displayRefLow.toFixed(displayRefLow % 1 === 0 ? 0 : 1)} – {displayRefHigh.toFixed(displayRefHigh % 1 === 0 ? 0 : 1)}
                    {displayUnit && (
                      <span className="text-sm font-normal text-muted-foreground ml-1">
                        {displayUnit}
                      </span>
                    )}
                  </div>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </CardContent>
            </Card>

            {/* Trend */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {t("observationHistory.trend")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {trend ? (
                  <div className="flex items-center gap-2">
                    {trend.direction === "up" && (
                      <>
                        <TrendingUp className="h-5 w-5 text-orange-500" />
                        <span className="text-lg font-semibold text-orange-500">
                          +{trend.percent.toFixed(1)}%
                        </span>
                      </>
                    )}
                    {trend.direction === "down" && (
                      <>
                        <TrendingDown className="h-5 w-5 text-blue-500" />
                        <span className="text-lg font-semibold text-blue-500">
                          -{trend.percent.toFixed(1)}%
                        </span>
                      </>
                    )}
                    {trend.direction === "stable" && (
                      <span className="text-muted-foreground">{t("observationHistory.stable")}</span>
                    )}
                  </div>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
                <p className="text-xs text-muted-foreground mt-1">
                  {observation.measurement_count} {t("observationHistory.measurements")}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Chart */}
          <Card>
            <CardHeader>
              <CardTitle>{t("observationHistory.chartTitle")}</CardTitle>
            </CardHeader>
            <CardContent>
              <ObservationChart 
                history={convertedHistory}
                unit={displayUnit}
                refLow={displayRefLow}
                refHigh={displayRefHigh}
              />
            </CardContent>
          </Card>

          {/* History table */}
          <Card>
            <CardHeader>
              <CardTitle>{t("observationHistory.historyTitle")}</CardTitle>
            </CardHeader>
            <CardContent>
              <HistoryTable history={convertedHistory} unit={displayUnit} />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
