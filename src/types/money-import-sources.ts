/**
 * Where an import comes from: a bank first, then the way its operations are brought in
 * (T-261026-2ew). Shared by the web import page and the iOS import screen, so both offer the same
 * banks in the same order and grey out the same ways.
 */
export type ImportBankId = "tbank" | "alfa" | "other";
export type ImportMethodKind = "extension" | "file";

export interface ImportSourceConnector {
  sourceId: string;
  kind: ImportMethodKind;
}

export interface ImportMethodOption {
  kind: ImportMethodKind;
  /** The connector that does it. */
  sourceId: string;
  /** Only the T-Bank personal account: it brings the most detail and needs no file. */
  recommended: boolean;
  /** False where this device cannot do it: the extension needs a desktop browser. */
  available: boolean;
}

export interface ImportBankOption {
  id: ImportBankId;
  methods: ImportMethodOption[];
  available: boolean;
}

const BANKS: readonly ImportBankId[] = ["tbank", "alfa", "other"];
const METHODS: readonly ImportMethodKind[] = ["extension", "file"];

/** The bank a connector's source belongs to: `tbank`, `tbank_web` and `tbank_csv` are T-Bank. */
export function importBankOfSource(sourceId: string): ImportBankId {
  const bank = sourceId.split("_")[0];
  return bank === "tbank" || bank === "alfa" ? bank : "other";
}

/**
 * Every bank with what this device can do for it. Within a bank and across banks, what is
 * available comes first and the rest keeps its place at the end, greyed out by the caller.
 */
export function importBankOptions(
  connectors: readonly ImportSourceConnector[],
  device: { extension: boolean },
): ImportBankOption[] {
  const banks = BANKS.map((id): ImportBankOption => {
    const methods = METHODS.flatMap((kind): ImportMethodOption[] => {
      const connector = connectors.find(
        (one) => one.kind === kind && importBankOfSource(one.sourceId) === id,
      );
      if (!connector) return [];
      return [
        {
          kind,
          sourceId: connector.sourceId,
          recommended: kind === "extension" && id === "tbank",
          available: kind === "file" || device.extension,
        },
      ];
    });
    return {
      id,
      methods: availableFirst(methods),
      available: methods.some((one) => one.available),
    };
  });
  return availableFirst(banks);
}

function availableFirst<T extends { available: boolean }>(items: T[]): T[] {
  return [...items.filter((one) => one.available), ...items.filter((one) => !one.available)];
}

/** Whether this browser can run the Orbit extension: not on a phone or a tablet. */
export function canRunImportExtension(userAgent: string): boolean {
  return !/Android|iPhone|iPad|iPod|Mobile/i.test(userAgent);
}
