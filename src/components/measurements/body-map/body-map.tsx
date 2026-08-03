"use client";

import React, { useId } from "react";
import { cn } from "@/lib/utils";
import { BAND_REGIONS, BODY_REGIONS, getBodyArtwork, type BodyModel } from "./regions";

export type RegionTone = "empty" | "flat" | "up" | "down";

interface BodyMapProps {
  model: BodyModel;
  /** Region id -> tone. Regions missing from this map render as "empty". */
  tones: Record<string, RegionTone>;
  activeRegionId?: string | null;
  onRegionSelect: (regionId: string) => void;
  /** Caller supplies the translated name — this component holds no i18n. */
  regionLabel: (regionId: string) => string;
  className?: string;
}

/**
 * Fills are written as literal colour functions rather than Tailwind classes
 * because SVG `fill` has no utility equivalent that resolves CSS variables.
 *
 * `up` and `down` are deliberately fixed orange/blue rather than `--chart-1` /
 * `--chart-2`: those two swap hue between themes (orange/teal in light,
 * blue/green in dark), which would leave a rising region filled blue next to
 * its orange arrow. The arrows are fixed `text-orange-500` / `text-blue-500`,
 * so the fills match them and direction means the same thing in both themes.
 *
 * `empty` and `flat` derive from tokens because they only need to read as
 * "a site" and "measured, steady" against whatever the background is.
 *
 * Colour is never the only signal — every region also carries a callout chip
 * with its value and a trend arrow.
 */
const TONE_FILL: Record<RegionTone, string> = {
  empty: "hsl(var(--muted-foreground) / 0.30)",
  flat: "hsl(var(--primary) / 0.32)",
  up: "rgb(249 115 22 / 0.45)",
  down: "rgb(59 130 246 / 0.45)",
};

/**
 * The body itself. `--muted` alone is 96.1% lightness on a white background,
 * which barely reads as a shape, so the silhouette is tinted with
 * `--muted-foreground` and given a firmer outline.
 */
const SILHOUETTE_FILL = "hsl(var(--muted-foreground) / 0.14)";
const SILHOUETTE_STROKE = "hsl(var(--muted-foreground) / 0.40)";

export function BodyMap({
  model,
  tones,
  activeRegionId,
  onRegionSelect,
  regionLabel,
  className,
}: BodyMapProps) {
  const artwork = getBodyArtwork(model);
  // useId keeps the clip path unique if two maps are ever mounted at once.
  const clipId = `body-clip-${useId().replace(/:/g, "")}-${model}`;

  return (
    <svg
      viewBox={artwork.viewBox}
      preserveAspectRatio="xMidYMid meet"
      className={cn("h-full w-full", className)}
      role="img"
      aria-label={`body-map-${model}`}
    >
      <defs>
        <clipPath id={clipId}>
          <path d={artwork.silhouette} />
        </clipPath>
      </defs>

      <path
        d={artwork.silhouette}
        fill={SILHOUETTE_FILL}
        stroke={SILHOUETTE_STROKE}
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
      />

      {BODY_REGIONS.map((region) => {
        const paths = artwork.regionPaths[region.id];
        if (!paths) {
          return null;
        }

        const tone = tones[region.id] ?? "empty";
        const isActive = activeRegionId === region.id;
        const label = regionLabel(region.id);

        return (
          <g
            key={region.id}
            role="button"
            tabIndex={0}
            aria-label={label}
            data-region-id={region.id}
            data-tone={tone}
            data-active={isActive || undefined}
            className="cursor-pointer outline-none focus-visible:opacity-80"
            onClick={() => onRegionSelect(region.id)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onRegionSelect(region.id);
              }
            }}
            // Bands are plain shapes of ours rather than vendored muscle
            // outlines, so they need clipping to stay inside the body.
            clipPath={BAND_REGIONS.has(region.id) ? `url(#${clipId})` : undefined}
          >
            <title>{label}</title>
            {paths.map((d, index) => (
              <path
                key={index}
                d={d}
                fill={TONE_FILL[tone]}
                stroke={isActive ? "hsl(var(--primary))" : "transparent"}
                strokeWidth={isActive ? 2 : 0}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </g>
        );
      })}
    </svg>
  );
}
