"use client";

import React from "react";
import { Minus, TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MeasurementTrend } from "@/lib/measurement-trend";
import { BodyMap, type RegionTone } from "./body-map";
import { layoutOnBodyLabels } from "./callout-layout";
import { getBodyArtwork, parseViewBox, type BodyModel } from "./regions";

export interface CalloutItem {
  regionId: string;
  /** measurement_catalog.code — always present, even with no readings yet. */
  code: string;
  /** Short label, used for the tooltip. */
  name: string;
  /**
   * Full spoken label — name, value, unit and trend. The label's visible text
   * is hidden from assistive tech by the explicit aria-label, so this is what a
   * screen-reader user actually hears. Built with describeMeasurement().
   */
  ariaLabel: string;
  unit: string;
  value: number | null;
  trend: MeasurementTrend | null;
}

interface BodyMapPanelProps {
  model: BodyModel;
  items: CalloutItem[];
  tones: Record<string, RegionTone>;
  activeRegionId?: string | null;
  onRegionSelect: (regionId: string) => void;
  regionLabel: (regionId: string) => string;
  emptyLabel: string;
  /**
   * The person's own sides. The body faces the viewer, so `left` is drawn on
   * the viewer's right — the header exists precisely to say so.
   */
  sideLabels: { left: string; right: string };
  className?: string;
}

/**
 * Rough label footprint as a share of the body box, used only to detect
 * overlaps. A bare number is about 34px wide and the body is at its narrowest
 * ~300px, hence ~13%.
 */
export const LABEL_WIDTH_PCT = 13;
export const LABEL_HEIGHT_PCT = 6;
export const EDGE_PADDING_PCT = 2;

function TrendIcon({ trend }: { trend: MeasurementTrend | null }) {
  if (trend === "up") {
    return <TrendingUp className="h-2.5 w-2.5 shrink-0 text-orange-500" aria-hidden />;
  }
  if (trend === "down") {
    return <TrendingDown className="h-2.5 w-2.5 shrink-0 text-blue-500" aria-hidden />;
  }
  if (trend === "flat") {
    return <Minus className="h-2.5 w-2.5 shrink-0 text-muted-foreground" aria-hidden />;
  }
  return null;
}

function formatValue(value: number): string {
  return value.toFixed(value % 1 === 0 ? 0 : 1);
}

/**
 * The body with each measurement written straight onto the spot it belongs to.
 *
 * Labels are pinned at their region's anchor rather than parked in a column at
 * the edge, so a value reads as belonging to that muscle without a leader line
 * to trace. They carry only the number and unit — on a body map the position
 * is what names the site — with the full name in the tooltip and in the spoken
 * label.
 */
export function BodyMapPanel({
  model,
  items,
  tones,
  activeRegionId,
  onRegionSelect,
  regionLabel,
  emptyLabel,
  sideLabels,
  className,
}: BodyMapPanelProps) {
  const artwork = getBodyArtwork(model);
  const { minX, minY, width, height } = parseViewBox(artwork.viewBox);

  const laidOut = layoutOnBodyLabels(
    items
      .filter((item) => artwork.anchors[item.regionId])
      .map((item) => ({ regionId: item.regionId, anchor: artwork.anchors[item.regionId] })),
    {
      labelWidthPct: LABEL_WIDTH_PCT,
      labelHeightPct: LABEL_HEIGHT_PCT,
      edgePaddingPct: EDGE_PADDING_PCT,
      viewBox: { minX, minY, width, height },
    },
  );

  const itemsById = new Map(items.map((item) => [item.regionId, item]));

  return (
    <div className={cn("mx-auto w-full", className)}>
      {/* Which half is whose side. The body faces the viewer, so the person's
          right arm is on the viewer's left — with only bare numbers on the
          body there is otherwise nothing to say which is which. This sits
          OUTSIDE the aspect-ratio box below: label positions are percentages
          of that box, so anything added inside it shifts them off their
          muscles. */}
      <div
        className="mb-1 flex items-center text-[9px] font-medium uppercase tracking-wide text-muted-foreground sm:text-[10px]"
        data-testid="body-side-header"
      >
        <span className="flex-1 text-center">{sideLabels.right}</span>
        <span aria-hidden className="h-3 w-px bg-border" />
        <span className="flex-1 text-center">{sideLabels.left}</span>
      </div>

      {/* The body takes the full width now that nothing sits beside it, and the
          box keeps the artwork's aspect ratio so a label positioned at a
          percentage lands exactly on its region. */}
      <div className="relative w-full" style={{ aspectRatio: `${width} / ${height}` }}>
        <BodyMap
          model={model}
          tones={tones}
          activeRegionId={activeRegionId}
          onRegionSelect={onRegionSelect}
          regionLabel={regionLabel}
        />

        {laidOut.map((label) => {
          const item = itemsById.get(label.regionId);
          if (!item) {
            return null;
          }

          const isActive = activeRegionId === label.regionId;
          const nudged = Math.abs(label.topPct - label.anchorYPct) > 0.5;

          return (
            <React.Fragment key={label.regionId}>
              {/* Only labels the packer had to move get a tether; for the rest
                the label already sits on its region. */}
              {nudged && (
                <span
                  aria-hidden
                  className="pointer-events-none absolute w-px bg-border"
                  style={{
                    left: `${label.anchorXPct}%`,
                    top: `${Math.min(label.topPct, label.anchorYPct)}%`,
                    height: `${Math.abs(label.topPct - label.anchorYPct)}%`,
                  }}
                />
              )}
              <button
                type="button"
                onClick={() => onRegionSelect(label.regionId)}
                aria-label={item.ariaLabel}
                title={item.name}
                data-region-id={label.regionId}
                style={{ left: `${label.leftPct}%`, top: `${label.topPct}%` }}
                className={cn(
                  "tap-target absolute flex -translate-x-1/2 -translate-y-1/2 items-baseline gap-0.5",
                  "rounded border bg-background/85 px-1 py-0.5 shadow-sm backdrop-blur-[2px]",
                  "transition-colors hover:bg-accent",
                  isActive ? "border-primary" : "border-border/70",
                  item.value === null && "opacity-70",
                )}
              >
                {/* Number only: every site on the body shares one unit, so
                  repeating it 13 times just makes the labels wide enough to
                  collide. The unit stays in the tooltip and the spoken label. */}
                {item.value === null ? (
                  <span className="text-[9px] leading-none text-muted-foreground sm:text-[10px]">
                    {emptyLabel}
                  </span>
                ) : (
                  <span className="text-[11px] font-semibold leading-none sm:text-xs">
                    {formatValue(item.value)}
                  </span>
                )}
                <TrendIcon trend={item.trend} />
              </button>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}
