import {
  resolveBodySiteCode,
  resolveFindingTypeCode,
  resolveObservationCode,
  type CodeResolution,
} from "./code-resolution.ts";
import type {
  BodySiteCatalogItem,
  FindingTypeCatalogItem,
  ObservationCatalogItem,
} from "./types.ts";

/**
 * Catalogue lookup.
 *
 * These wrappers keep the original code-only entry points for callers that genuinely have a code
 * and nothing else, and add label-aware variants that delegate to the tiered resolver in
 * `code-resolution.ts`. Prefer the label-aware ones: the model's code is a hint, and the printed
 * label is the stronger signal.
 */

export function findCatalogEntry<T extends { obs_code: string }>(
  obsCode: string | null,
  catalog: T[],
): T | null {
  if (!obsCode) return null;
  return catalog.find((item) => item.obs_code === obsCode) ?? null;
}

export function findFindingTypeCatalogEntry<T extends { finding_code: string }>(
  findingCode: string | null,
  catalog: T[],
): T | null {
  if (!findingCode) return null;
  return catalog.find((item) => item.finding_code === findingCode) ?? null;
}

export function findBodySiteCatalogEntry<T extends { site_code: string }>(
  siteCode: string | null,
  catalog: T[],
): T | null {
  if (!siteCode) return null;
  return catalog.find((item) => item.site_code === siteCode) ?? null;
}

export function resolveObservation(
  obsCode: string | null,
  obsName: string | null,
  catalog: ObservationCatalogItem[],
): CodeResolution<ObservationCatalogItem> {
  return resolveObservationCode(obsCode, obsName, catalog);
}

export function resolveFindingType(
  findingCode: string | null,
  findingText: string | null,
  catalog: FindingTypeCatalogItem[],
): CodeResolution<FindingTypeCatalogItem> {
  return resolveFindingTypeCode(findingCode, findingText, catalog);
}

export function resolveBodySite(
  siteCode: string | null,
  siteText: string | null,
  catalog: BodySiteCatalogItem[],
): CodeResolution<BodySiteCatalogItem> {
  return resolveBodySiteCode(siteCode, siteText, catalog);
}
