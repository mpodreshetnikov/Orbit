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
  },
];

export function normalizeMoneyImportSourceIdInput(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^source=(.+)$/i);
  return match ? match[1]!.trim() : trimmed;
}

export function sanitizeMoneyImportSourceKey(sourceId: string): string {
  const normalized = normalizeMoneyImportSourceIdInput(sourceId).toLowerCase();
  const withoutSuffix = normalized.replace(/_web$/, "").replace(/-web$/, "");
  return withoutSuffix.replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "source";
}

export function getMoneyImportSourcePreset(sourceId: string): MoneyImportSourcePreset {
  const normalizedSourceId = normalizeMoneyImportSourceIdInput(sourceId);
  const known = MONEY_IMPORT_SOURCE_DEFINITIONS.find(
    (source) => source.sourceId === normalizedSourceId,
  );
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

export function listMoneyImportSourceDefinitions(): MoneyImportSourceDefinition[] {
  return [...MONEY_IMPORT_SOURCE_DEFINITIONS];
}
