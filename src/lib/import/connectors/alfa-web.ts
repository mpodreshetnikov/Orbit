/**
 * Alfa Bank web connector metadata.
 * Parsing is performed by the Chrome extension, not by the web app.
 */

import { registerConnector } from "../connector-types";

const SOURCE_ID = "alfa_web";

const alfaWebConnector = {
  sourceId: SOURCE_ID,
  displayName: "Alfa Bank Web",
  kind: "extension" as const,
  websiteUrl: "https://web.alfabank.ru/",
  guideUrl: "https://web.alfabank.ru/",
  release: {
    latestDownloadUrl: "/api/extension-release/latest/download",
  },
};

registerConnector(alfaWebConnector);

export { alfaWebConnector };
