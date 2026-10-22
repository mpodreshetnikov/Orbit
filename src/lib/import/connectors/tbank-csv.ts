/**
 * T-Bank operations CSV connector: the parsing lives in `src/types/money-import-tbank-csv.ts`,
 * shared with the iOS client.
 */

import { registerConnector } from "../connector-types";
import { parseTBankCsv, TBANK_CSV_SOURCE_ID } from "@/types/money-import-tbank-csv";

export {
  COL,
  extractAccountHint,
  isTransfer,
  parseAmount,
  parseCSV,
  parseTBankDate,
} from "@/types/money-import-tbank-csv";

const parse = async (file: File) => parseTBankCsv(await file.text());

const tbankConnector = {
  sourceId: TBANK_CSV_SOURCE_ID,
  displayName: "T-Bank (CSV)",
  kind: "file" as const,
  fileAccept: {
    "text/csv": [".csv"],
    "text/plain": [".csv"],
    "application/vnd.ms-excel": [".csv"],
  },
  parse,
};

registerConnector(tbankConnector);

export { tbankConnector };
