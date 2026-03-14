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
}

const MONEY_IMPORT_SOURCE_DEFINITIONS: MoneyImportSourceDefinition[] = [
  {
    sourceId: "tbank_web",
    sourceKey: "tbank",
    accountSource: "tbank",
    displayName: "T-Bank Web",
    targetUrl: "https://www.tbank.ru/mybank/operations/",
    tabUrlPatterns: ["https://www.tbank.ru/*", "https://*.tbank.ru/*"],
    tabUrlContains: "/mybank/operations",
    apiUrlRegex: "https://(?:www\\.)?tbank\\.ru/api/common/v1/",
    hostnamePattern: /(^|\.)tbank\.ru$/i,
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
