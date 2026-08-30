/**
 * Replays a recorded bank session so the connector can be exercised without signing in.
 *
 * Every request the connector makes carries a `sessionid` scraped from a live authorised
 * page, and the parsing itself runs inside the bank's tab. That is why the full path — fetch
 * ranges, map operations, request receipts, chunk, send — has never been covered by a test:
 * there is no way to get an authorised page in CI, and there never will be. Recording one
 * live session and replaying it is the way around that, and it is the same shape already used
 * for the medical extraction evaluation.
 *
 * Recording is the one manual step of this whole design and stays manual on purpose: signing
 * in cannot be automated, and pretending otherwise would make CI both flaky and a risk to the
 * account.
 */

export interface CassetteEntry {
  /** Request URL as recorded, with identifying query parameters already redacted. */
  url: string;
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

export interface Cassette {
  name: string;
  entries: CassetteEntry[];
}

export interface CassettePlayer {
  fetch: typeof fetch;
  /** Requests that found no recorded response — an empty list is the point of the test. */
  misses: string[];
  /** Recorded responses that were never asked for. */
  unused(): CassetteEntry[];
}

/**
 * Matching ignores the query parameters that differ per run (the session id) and the ones the
 * splitting logic varies (the range bounds), so a cassette keeps working when the connector
 * legitimately asks for the same data in a different shape.
 */
function matchKey(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    const params = Array.from(url.searchParams.entries())
      .filter(([name]) => !["sessionid", "start", "end"].includes(name.toLowerCase()))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, value]) => `${name}=${value}`)
      .join("&");
    return params ? `${url.origin}${url.pathname}?${params}` : `${url.origin}${url.pathname}`;
  } catch {
    return rawUrl;
  }
}

/** Statuses the Fetch spec says carry no body; `new Response(body, { status })` throws for them. */
const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);

export function createCassettePlayer(cassette: Cassette): CassettePlayer {
  const byKey = new Map<string, CassetteEntry[]>();
  for (const entry of cassette.entries) {
    const key = matchKey(entry.url);
    const bucket = byKey.get(key) ?? [];
    bucket.push(entry);
    byKey.set(key, bucket);
  }

  const consumed = new Set<CassetteEntry>();
  const misses: string[] = [];

  const player: CassettePlayer = {
    misses,
    unused: () => cassette.entries.filter((entry) => !consumed.has(entry)),
    fetch: (async (input: RequestInfo | URL) => {
      const requestUrl = typeof input === "string" ? input : input.toString();
      const bucket = byKey.get(matchKey(requestUrl)) ?? [];
      const entry = bucket.find((candidate) => !consumed.has(candidate)) ?? bucket[0];

      if (!entry) {
        misses.push(requestUrl);
        // A miss is reported through the response rather than thrown: the connector treats a
        // failed request as a range it could not read, which is what a real gap looks like.
        return new Response(null, { status: 404 });
      }

      consumed.add(entry);
      // The Fetch spec forbids a body on these statuses, and the `Response` constructor throws
      // rather than ignoring one. `JSON.stringify(null)` is the four-character string "null",
      // which counts as a body — so a cassette holding a 204 blew the replay up on construction,
      // before the connector saw anything it could handle.
      if (NULL_BODY_STATUSES.has(entry.status)) {
        return new Response(null, { status: entry.status });
      }
      return new Response(JSON.stringify(entry.body ?? null), {
        status: entry.status,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch,
  };

  return player;
}
