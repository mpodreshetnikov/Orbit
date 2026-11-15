import type { Page, Route } from "@playwright/test";
import {
  createCassettePlayer,
  type Cassette,
} from "../../browserExtension/src/connectors/cassette-replay";

/**
 * Serve a recorded (or synthetic) T-Bank cassette through Playwright `page.route`, so the
 * connector's bank fetches never leave the machine. Matching is the same `createCassettePlayer`
 * used by the extension contract suite.
 */
export async function installCassetteRoute(
  page: Page,
  cassette: Cassette,
): Promise<{ misses: () => string[] }> {
  const player = createCassettePlayer(cassette);

  await page.route("https://www.tbank.ru/api/**", async (route: Route) => {
    const request = route.request();
    const response = await player.fetch(request.url());
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });
    const body = await response.arrayBuffer();
    await route.fulfill({
      status: response.status,
      headers,
      body: Buffer.from(body),
    });
  });

  return {
    misses: () => [...player.misses],
  };
}
