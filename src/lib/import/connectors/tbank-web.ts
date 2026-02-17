/**
 * T-Bank web connector metadata.
 * Parsing is performed by the Chrome extension, not by the web app.
 */

import { registerConnector } from "../connector-types";

const SOURCE_ID = "tbank_web";

const tbankWebConnector = {
  sourceId: SOURCE_ID,
  displayName: "T-Bank Web",
  kind: "extension" as const,
  websiteUrl: "https://www.tbank.ru/mybank/",
  guideUrl: "https://www.tbank.ru/mybank/",
};

registerConnector(tbankWebConnector);

export { tbankWebConnector };
