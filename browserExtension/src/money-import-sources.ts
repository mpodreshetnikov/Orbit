export interface MoneyImportSourcePreset {
  sourceKey: string;
  targetUrl: string;
  tabUrlPatterns: string[];
  tabUrlContains: string;
  apiUrlRegex: string;
}

export interface MoneyImportSourceDefinition extends MoneyImportSourcePreset {
  sourceId: string;
  accountSource: string;
  displayName: string;
  hostnamePattern: RegExp;
  /**
   * Every origin the bank serves its site from, the one `targetUrl` names first. A tab on any of
   * them is the bank's; a slow load on one is moved to the next (see `core/slow-load-fallback.ts`).
   */
  siteOrigins: string[];
}

const MONEY_IMPORT_SOURCE_DEFINITIONS: MoneyImportSourceDefinition[] = [
  {
    sourceId: "tbank_web",
    sourceKey: "tbank",
    accountSource: "tbank",
    displayName: "T-Bank Web",
    targetUrl: "https://www.tbank.ru/mybank/operations/",
    // tbank-online.com is the bank's own mirror of the same site and API (checked 2026-10-26),
    // with a sign-in of its own: its cookies and SSO are scoped to that domain.
    tabUrlPatterns: [
      "https://www.tbank.ru/*",
      "https://*.tbank.ru/*",
      "https://www.tbank-online.com/*",
      "https://*.tbank-online.com/*",
    ],
    tabUrlContains: "/mybank/operations",
    apiUrlRegex: "https://(?:www\\.)?tbank(?:\\.ru|-online\\.com)/api/common/v1/",
    hostnamePattern: /(^|\.)(tbank\.ru|tbank-online\.com)$/i,
    siteOrigins: ["https://www.tbank.ru", "https://www.tbank-online.com"],
  },
  {
    sourceId: "alfa_web",
    sourceKey: "alfa",
    accountSource: "alfa",
    displayName: "Alfa Bank Web",
    targetUrl: "https://web.alfabank.ru/",
    tabUrlPatterns: ["https://web.alfabank.ru/*", "https://*.alfabank.ru/*"],
    tabUrlContains: "web.alfabank.ru",
    apiUrlRegex: "https://(?:[^/]+\\.)?alfabank\\.ru/",
    hostnamePattern: /(^|\.)alfabank\.ru$/i,
    siteOrigins: ["https://web.alfabank.ru"],
  },
];

export function sanitizeMoneyImportSourceKey(sourceId: string): string {
  const normalized = sourceId.trim().toLowerCase();
  const withoutSuffix = normalized.replace(/_web$/, "").replace(/-web$/, "");
  return withoutSuffix.replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "source";
}

export function listMoneyImportSourceDefinitions(): MoneyImportSourceDefinition[] {
  return [...MONEY_IMPORT_SOURCE_DEFINITIONS];
}

export function getMoneyImportSourceDefinition(
  sourceId: string | null | undefined,
): MoneyImportSourceDefinition | null {
  if (typeof sourceId !== "string") return null;
  return MONEY_IMPORT_SOURCE_DEFINITIONS.find((source) => source.sourceId === sourceId) ?? null;
}

export function getMoneyImportSourcePreset(sourceId: string): MoneyImportSourcePreset {
  const known = getMoneyImportSourceDefinition(sourceId);
  if (known) {
    return {
      sourceKey: known.sourceKey,
      targetUrl: known.targetUrl,
      tabUrlPatterns: [...known.tabUrlPatterns],
      tabUrlContains: known.tabUrlContains,
      apiUrlRegex: known.apiUrlRegex,
    };
  }

  return {
    sourceKey: sanitizeMoneyImportSourceKey(sourceId),
    targetUrl: "",
    tabUrlPatterns: [],
    tabUrlContains: "",
    apiUrlRegex: "",
  };
}

export function getMoneyImportSourcePagePatterns(sourceId: string | null | undefined): string[] {
  return [...(getMoneyImportSourceDefinition(sourceId)?.tabUrlPatterns ?? [])];
}

export function getAllMoneyImportSourcePagePatterns(): string[] {
  return Array.from(
    new Set(MONEY_IMPORT_SOURCE_DEFINITIONS.flatMap((source) => source.tabUrlPatterns)),
  );
}

export function matchesMoneyImportSourcePageUrl(
  sourceId: string | null | undefined,
  url: string | undefined,
): boolean {
  if (!url) return false;
  const source = getMoneyImportSourceDefinition(sourceId);
  if (!source) return false;

  try {
    return source.hostnamePattern.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

export function matchesKnownMoneyImportSourcePageUrl(url: string | undefined): boolean {
  if (!url) return false;
  return MONEY_IMPORT_SOURCE_DEFINITIONS.some((source) =>
    matchesMoneyImportSourcePageUrl(source.sourceId, url),
  );
}

export function shouldShowMoneyImportSourcePageWidget(
  session: Record<string, unknown> | null | undefined,
): boolean {
  const sourceId = typeof session?.source === "string" ? session.source : null;
  return (
    session?.show_source_page_widget === true && getMoneyImportSourceDefinition(sourceId) !== null
  );
}

function originOf(url: string | null | undefined): string | null {
  if (typeof url !== "string") return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** The site origin a source URL is on, or null when it is on none of them. */
export function findMoneyImportSourceSiteOrigin(
  sourceId: string | null | undefined,
  url: string | null | undefined,
): string | null {
  const origin = originOf(url);
  if (!origin) return null;
  return getMoneyImportSourceDefinition(sourceId)?.siteOrigins.includes(origin) ? origin : null;
}

/** The known source whose site a URL is on, by exact site origin. */
export function findMoneyImportSourceBySiteUrl(
  url: string | null | undefined,
): MoneyImportSourceDefinition | null {
  const origin = originOf(url);
  if (!origin) return null;
  return (
    MONEY_IMPORT_SOURCE_DEFINITIONS.find((source) => source.siteOrigins.includes(origin)) ?? null
  );
}

/**
 * The same page on another of the source's site origins: `origin` when given and known, else the
 * next one after the URL's own, wrapping around. Null when the URL is on none of them, or when
 * the source has only the one.
 */
export function moveMoneyImportSourceUrl(
  sourceId: string | null | undefined,
  url: string,
  origin?: string | null,
): string | null {
  const origins = getMoneyImportSourceDefinition(sourceId)?.siteOrigins ?? [];
  const current = findMoneyImportSourceSiteOrigin(sourceId, url);
  if (!current || origins.length < 2) return null;
  const target =
    origin && origins.includes(origin)
      ? origin
      : origins[(origins.indexOf(current) + 1) % origins.length];
  if (target === current) return null;
  const parsed = new URL(url);
  return `${target}${parsed.pathname}${parsed.search}${parsed.hash}`;
}
