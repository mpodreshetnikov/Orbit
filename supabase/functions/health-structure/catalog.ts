interface ObservationCatalogLike {
  obs_code: string;
}

interface FindingTypeCatalogLike {
  finding_code: string;
}

interface BodySiteCatalogLike {
  site_code: string;
}

export function findCatalogEntry<T extends ObservationCatalogLike>(
  obsCode: string | null,
  catalog: T[],
): T | null {
  if (!obsCode) return null;
  return catalog.find((item) => item.obs_code === obsCode) ?? null;
}

export function findFindingTypeCatalogEntry<T extends FindingTypeCatalogLike>(
  findingCode: string | null,
  catalog: T[],
): T | null {
  if (!findingCode) return null;
  return catalog.find((item) => item.finding_code === findingCode) ?? null;
}

export function findBodySiteCatalogEntry<T extends BodySiteCatalogLike>(
  siteCode: string | null,
  catalog: T[],
): T | null {
  if (!siteCode) return null;
  return catalog.find((item) => item.site_code === siteCode) ?? null;
}
