"use client";

import React, { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Minus, TrendingDown, TrendingUp } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { usePersons } from "@/hooks";
import { getMeasurementTrend, type MeasurementTrend } from "@/lib/measurement-trend";
import { cn } from "@/lib/utils";
import type { MeasurementSummary } from "@/types";
import { AddMeasurementDialog } from "../add-measurement-dialog";
import { BodyMapPanel, type CalloutItem } from "./body-map-callouts";
import { describeMeasurement } from "./describe";
import type { RegionTone } from "./body-map";
import {
  BODY_REGIONS,
  CODE_TO_REGION,
  REGION_TO_CODE,
  WHOLE_BODY_CODES,
  getBodyModelForSex,
} from "./regions";

interface BodyMeasurementsViewProps {
  personId: string | null;
  /**
   * Already fetched by the page — this view adds no query of its own. The page
   * has already dropped hidden codes from this list.
   */
  measurements: MeasurementSummary[];
  /**
   * Codes the person has hidden. Needed separately from `measurements` because
   * the region list is fixed, not data-driven: a region with no readings still
   * gets an "Add" label, so filtering the data alone would leave a hidden site
   * showing on the body while Cards and Table had dropped it.
   */
  hiddenCodes?: ReadonlySet<string>;
  locale: string;
}

interface StatRow {
  code: string;
  name: string;
  /** Spoken label — see CalloutItem.ariaLabel. */
  ariaLabel: string;
  unit: string;
  value: number | null;
  trend: MeasurementTrend | null;
}

function toneFor(trend: MeasurementTrend | null, hasValue: boolean): RegionTone {
  if (!hasValue) {
    return "empty";
  }
  if (trend === "up" || trend === "down") {
    return trend;
  }
  return "flat";
}

function TrendIcon({ trend }: { trend: MeasurementTrend | null }) {
  if (trend === "up") {
    return <TrendingUp className="h-3.5 w-3.5 shrink-0 text-orange-500" aria-hidden />;
  }
  if (trend === "down") {
    return <TrendingDown className="h-3.5 w-3.5 shrink-0 text-blue-500" aria-hidden />;
  }
  if (trend === "flat") {
    return <Minus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />;
  }
  return null;
}

function formatValue(value: number): string {
  return value.toFixed(value % 1 === 0 ? 0 : 1);
}

function StatCard({
  row,
  emptyLabel,
  onSelect,
}: {
  row: StatRow;
  emptyLabel: string;
  onSelect: (code: string) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border p-2 sm:p-3">
      <div className="min-w-0">
        <Link
          href={`/health/measurements/${encodeURIComponent(row.code)}`}
          className="block truncate text-[11px] text-muted-foreground hover:underline sm:text-xs"
        >
          {row.name}
        </Link>
        <button
          type="button"
          onClick={() => onSelect(row.code)}
          aria-label={row.ariaLabel}
          className="tap-target flex items-baseline gap-1 text-left"
        >
          {row.value === null ? (
            <span className="text-xs text-muted-foreground sm:text-sm">{emptyLabel}</span>
          ) : (
            <>
              <span className="text-sm font-semibold sm:text-base">{formatValue(row.value)}</span>
              {row.unit && <span className="text-[10px] text-muted-foreground">{row.unit}</span>}
            </>
          )}
          <TrendIcon trend={row.trend} />
        </button>
      </div>
    </div>
  );
}

export function BodyMeasurementsView({
  personId,
  measurements,
  hiddenCodes,
  locale,
}: BodyMeasurementsViewProps) {
  const t = useTranslations();
  const { data: persons } = usePersons();
  const [addCode, setAddCode] = useState<string | null>(null);

  const person = useMemo(
    () => persons?.find((candidate) => candidate.id === personId) ?? null,
    [persons, personId],
  );

  // Taken from the person's profile, with no override on the page: the model
  // describes who is being measured, not a preference about this view.
  const model = getBodyModelForSex(person?.sex);

  // The page hides the Body tab for pets; this keeps the component honest on
  // its own, so a pet's id reaching it never renders a human silhouette.
  const isPet = person?.kind === "pet";

  const summaryByCode = useMemo(
    () => new Map(measurements.map((summary) => [summary.code, summary])),
    [measurements],
  );

  const nameOf = (summary: MeasurementSummary) =>
    locale === "ru" ? summary.name_ru : summary.name_en;
  const unitOf = (summary: MeasurementSummary) =>
    locale === "ru" ? summary.unit_ru : summary.unit_en;

  // Every region gets a chip, whether or not the person has a reading for it —
  // an empty chip is how a new site gets seeded. Hidden sites are the one
  // exception: the user said they do not track those, so the region stays bare.
  const items: CalloutItem[] = useMemo(
    () =>
      BODY_REGIONS.filter((region) => !hiddenCodes?.has(REGION_TO_CODE[region.id])).map(
        (region) => {
          const code = REGION_TO_CODE[region.id];
          const summary = summaryByCode.get(code);
          const name = summary ? nameOf(summary) : t(region.labelKey);
          const unit = summary ? unitOf(summary) : "";
          const value = summary && summary.measurement_count > 0 ? summary.latest_value : null;
          const trend = summary ? getMeasurementTrend(summary.history) : null;
          return {
            regionId: region.id,
            code,
            name,
            ariaLabel: describeMeasurement({ name, value, unit, trend, t }),
            unit,
            value,
            trend,
          };
        },
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [summaryByCode, locale, t, hiddenCodes],
  );

  const tones: Record<string, RegionTone> = useMemo(
    () =>
      Object.fromEntries(
        items.map((item) => [item.regionId, toneFor(item.trend, item.value !== null)]),
      ),
    [items],
  );

  const toStatRow = (summary: MeasurementSummary): StatRow => {
    const name = nameOf(summary);
    const unit = unitOf(summary);
    const value = summary.measurement_count > 0 ? summary.latest_value : null;
    const trend = getMeasurementTrend(summary.history);
    return {
      code: summary.code,
      name,
      ariaLabel: describeMeasurement({ name, value, unit, trend, t }),
      unit,
      value,
      trend,
    };
  };

  const wholeBodyRows: StatRow[] = useMemo(
    () =>
      WHOLE_BODY_CODES.map((code) => summaryByCode.get(code))
        .filter((summary): summary is MeasurementSummary => summary !== undefined)
        .map(toStatRow),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [summaryByCode, locale, t],
  );

  // Custom catalog entries have no place on the silhouette. They still belong
  // to the person, so they are listed rather than silently dropped.
  const otherRows: StatRow[] = useMemo(
    () =>
      measurements
        .filter(
          (summary) => !CODE_TO_REGION[summary.code] && !WHOLE_BODY_CODES.includes(summary.code),
        )
        .map(toStatRow),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [measurements, locale, t],
  );

  const emptyLabel = t("measurements.noValueYet");

  if (isPet) {
    return null;
  }

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-[3fr_1fr] lg:gap-6">
        <div>
          {/* Capping the width caps the body's height too, since the panel is
              driven by the artwork's aspect ratio (roughly 1:2). Nothing sits
              beside the body any more, so this is purely about keeping it a
              comfortable height rather than reserving room for gutters. */}
          <div className="mx-auto w-full max-w-[300px] sm:max-w-[340px] lg:max-w-[380px]">
            <BodyMapPanel
              model={model}
              items={items}
              tones={tones}
              onRegionSelect={(regionId) => setAddCode(REGION_TO_CODE[regionId])}
              regionLabel={(regionId) =>
                items.find((item) => item.regionId === regionId)?.ariaLabel ?? regionId
              }
              emptyLabel={emptyLabel}
              sideLabels={{
                left: t("measurements.sideLeft"),
                right: t("measurements.sideRight"),
              }}
            />
          </div>
        </div>

        <div
          className={cn(
            "space-y-4",
            wholeBodyRows.length === 0 && otherRows.length === 0 && "hidden",
          )}
        >
          {wholeBodyRows.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t("measurements.wholeBody")}
              </h3>
              <div className="grid grid-cols-2 gap-2 lg:grid-cols-1">
                {wholeBodyRows.map((row) => (
                  <StatCard
                    key={row.code}
                    row={row}
                    emptyLabel={emptyLabel}
                    onSelect={setAddCode}
                  />
                ))}
              </div>
            </div>
          )}

          {otherRows.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t("measurements.otherMeasurements")}
              </h3>
              <div className="grid grid-cols-2 gap-2 lg:grid-cols-1">
                {otherRows.map((row) => (
                  <StatCard
                    key={row.code}
                    row={row}
                    emptyLabel={emptyLabel}
                    onSelect={setAddCode}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {measurements.length === 0 && (
        <Card className="mt-4">
          <CardContent className="py-6 text-center text-sm text-muted-foreground">
            {t("measurements.bodyViewEmptyHint")}
          </CardContent>
        </Card>
      )}

      <AddMeasurementDialog
        open={addCode !== null}
        onOpenChange={(open) => {
          if (!open) {
            setAddCode(null);
          }
        }}
        personId={personId}
        preselectedCode={addCode ?? undefined}
      />
    </>
  );
}
