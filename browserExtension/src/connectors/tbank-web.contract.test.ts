/// <reference types="vite/client" />
import { describe, expect, it, vi } from "vitest";
import { __test__ } from "./tbank-web.js";
import { createCassettePlayer, type Cassette } from "./cassette-replay";

/**
 * Guards the shape of the bank's responses, which is a contract nobody tells us about when it
 * changes. The connector already counts the operations it had to drop while mapping
 * (`mapping_drop_counts`); the point of this suite is that a changed response makes that
 * counter non-zero and fails loudly, instead of quietly producing fewer rows than the bank
 * actually returned.
 *
 * Cassettes are enumerated through `import.meta.glob` rather than the filesystem: extension
 * runtime code may not import Node modules, and build scripts may not import extension
 * runtime code, so neither `node:fs` here nor a home under `scripts/` is available. Both
 * rules are worth keeping intact — and Vite resolves the fixtures at build time anyway.
 *
 * Recording a cassette needs a signed-in bank session and is therefore a manual step:
 *
 *     just extension-debug-live tbank_web 10
 *
 * then run the recording through scripts/extension/cassette-scrub.ts and commit the result to
 * test/fixtures/tbank/cassettes/<case>/. Until a cassette is committed this suite reports that
 * it has nothing to check rather than passing silently on nothing.
 */

/**
 * The reconciliation totals a recorder writes into a cassette.
 *
 * Declared here rather than imported: the type lives in `scripts/extension/`, and extension
 * runtime code may not import build scripts any more than the reverse. The same split already
 * applies to the dedupe formula, and the shape is small enough that a mismatch shows up as a
 * failing assertion rather than a silent skip — `summary` is optional, so a cassette recorded
 * before this existed simply does not get the check.
 */
interface RecordedSummary {
  months: Array<{
    month: string;
    currency: string;
    operations: number;
    income: string;
    expense: string;
    complete?: boolean;
  }>;
}

/** Moscow is a fixed UTC+03:00, which is the clock the bank prints and totals in. */
const MOSCOW_OFFSET_MS = 3 * 60 * 60 * 1000;

const cassetteModules = import.meta.glob<{ default: Cassette }>(
  "../../../test/fixtures/tbank/cassettes/*/cassette.json",
  { eager: true },
);

/**
 * The fixture directory names the cassette, not the `name` inside the file.
 *
 * That field is whatever the recorder was told, and the paste-ready recorder defaults every
 * recording to `dense-month` — so a second fixture committed without editing it would carry the
 * first one's name into the test titles and, worse, into anything keyed by it. The directory is
 * unique by construction because the filesystem says so.
 */
const cassettes: Cassette[] = Object.entries(cassetteModules).map(([filePath, module]) => {
  const parsed = module.default;
  const directory = filePath.split("/").slice(-2, -1)[0] ?? "unnamed";
  return { ...parsed, name: directory };
});

/**
 * The connector reads its page through globals — the origin it is on, the resource timeline it
 * discovers endpoints from, and `fetch`. In a node test none of those exist, so the replay has
 * to supply them: the origin and the endpoint URLs come out of the cassette itself, which is
 * the point — a recording that never captured an endpoint cannot make the connector ask for it.
 */
/**
 * The player's own match key, restated: origin and path plus every query parameter except the
 * three that legitimately vary between runs. Duplicated rather than imported because it is not
 * exported, and because a test that counted requests by a *different* key would agree with the
 * player about nothing.
 */
function requestsPerKey(urls: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const raw of urls) {
    const url = new URL(raw);
    const params = Array.from(url.searchParams.entries())
      .filter(([name]) => !["sessionid", "start", "end"].includes(name.toLowerCase()))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, value]) => `${name}=${value}`)
      .join("&");
    const key = params ? `${url.origin}${url.pathname}?${params}` : `${url.origin}${url.pathname}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

/**
 * `buildOperationKey`'s last resort, reproduced from the raw operation rather than from the row.
 *
 * Every field in it is a raw one, and each differs from its mapped counterpart in a way that
 * merges two operations the connector keeps apart. The timestamp is the millisecond number, not
 * the ISO string. The amount is the bank's own value — T-Bank writes a purchase as a *positive*
 * `accountAmount.value` with `type: "Debit"`, so `10`/Debit and `-10` are two identities to the
 * connector and one signed `-10` to the mapper. And the description is `operation.description`
 * or the literal "unknown", not the merchant label, which falls through `merchant.name` and
 * `subgroup.name` before defaulting to "T-Bank operation". Built from the row, this collapsed
 * identities the connector counts separately and would have failed a cassette that is correct.
 *
 * `||` on the timestamp, not `??`, because that is what the connector's `extractTimeMs` uses: a
 * `milliseconds: 0` placeholder is a fall-through there and a value under `??`.
 */
function fallbackIdentity(operation: Record<string, unknown>): string {
  // `toNum`, restated: a numeric string is a number to the connector. Without the coercion,
  // `"1787227199000"` fell through to `new Date("1787227199000")`, which does not parse it, and
  // two distinct operations collapsed into one `fallback:null:null:…` identity.
  const asNumber = (value: unknown): number | null => {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  };
  const ms = (value: unknown): number | null => {
    const numberValue = asNumber(value);
    if (numberValue !== null) return numberValue;
    if (typeof value === "string" && value.trim()) {
      const parsed = new Date(value).getTime();
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  };
  const nested = (value: unknown, key: string): unknown =>
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)[key]
      : undefined;

  const operationMs =
    ms(nested(operation.operationTime, "milliseconds")) ||
    ms(nested(operation.debitingTime, "milliseconds")) ||
    ms(operation.operationDateTime);
  const amount =
    asNumber(nested(operation.accountAmount, "value")) ??
    asNumber(nested(operation.amount, "value"));
  const description =
    (typeof operation.description === "string" ? operation.description.trim() : "") || "unknown";
  return `fallback:${operationMs}:${amount}:${description}`;
}

function installPageGlobals(
  player: ReturnType<typeof createCassettePlayer>,
  cassette: Cassette,
  fetched: string[],
): () => void {
  const scope = globalThis as Record<string, unknown>;
  const origin = new URL(cassette.entries[0]?.url ?? "https://www.tbank.ru").origin;

  // One URL per endpoint the recording actually holds, newest last: `findLatestResourceUrlByPath`
  // walks the timeline backwards and takes the first match.
  const resourceUrls = Array.from(
    new Map(
      cassette.entries.map((entry) => [new URL(entry.url).pathname, entry.url] as const),
    ).values(),
  );

  const saved = {
    window: scope.window,
    document: scope.document,
    fetch: scope.fetch,
    getEntriesByType: performance.getEntriesByType,
  };

  scope.window = { location: { origin, href: `${origin}/mybank/operations/` } };
  scope.document = { body: { innerText: "" }, querySelectorAll: () => [] };
  scope.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    fetched.push(typeof input === "string" ? input : input.toString());
    return player.fetch(input, init);
  }) as typeof fetch;
  performance.getEntriesByType = ((type: string) =>
    type === "resource"
      ? resourceUrls.map((name) => ({ name }))
      : []) as typeof performance.getEntriesByType;

  return () => {
    scope.window = saved.window;
    scope.document = saved.document;
    scope.fetch = saved.fetch;
    performance.getEntriesByType = saved.getEntriesByType;
  };
}

/**
 * One replay per cassette, shared by every test that needs its result.
 *
 * Replaying is by far the most expensive thing this suite does — it drives the whole connector,
 * including its paced receipt requests — and two tests need what comes out of it: the one that
 * checks the connector asked for exactly what was recorded, and the one that checks the enriched
 * records it came back with still map into complete rows. Running it once and awaiting the same
 * promise twice keeps those two checks independent without paying for the walk twice.
 */
interface ReplayResult {
  extraction: Awaited<ReturnType<typeof __test__.extractOperationsInPage>>;
  player: ReturnType<typeof createCassettePlayer>;
  fetched: string[];
}

// Keyed by the cassette itself rather than by anything written inside it. A name is a label; two
// fixtures sharing one would have made the second cassette's tests inspect the first cassette's
// replay — passing on the wrong evidence, which is worse than failing.
const replays = new Map<Cassette, Promise<ReplayResult>>();

function replayCassette(cassette: Cassette): Promise<ReplayResult> {
  const started = replays.get(cassette) ?? runReplay(cassette);
  replays.set(cassette, started);
  return started;
}

async function runReplay(cassette: Cassette): Promise<ReplayResult> {
  const player = createCassettePlayer(cassette);

  // The window is taken from the recording itself, and the clock is frozen at its end. The
  // player ignores `start` and `end` when matching, but not how many requests are made: asked
  // for a wider window than was recorded, the connector walks extra ranges and reuses the first
  // recorded response for each. Freezing the clock makes the request sequence the recorded
  // sequence, which is the property the recorder is built to guarantee.
  const bounds = cassette.entries
    .filter((entry) => entry.url.includes("/api/common/v1/operations"))
    .map((entry) => new URL(entry.url).searchParams)
    .map((params) => ({ start: Number(params.get("start")), end: Number(params.get("end")) }))
    .filter(({ start, end }) => Number.isFinite(start) && Number.isFinite(end));
  const windowFromMs = Math.min(...bounds.map(({ start }) => start));
  const windowToMs = Math.max(...bounds.map(({ end }) => end));

  // Fake timers first: enabling them replaces `performance`, which would take the resource
  // timeline the page globals install with it — and endpoint discovery would then find nothing,
  // silently, with every enrichment entry left unused.
  vi.useFakeTimers();
  vi.setSystemTime(windowToMs);
  const fetched: string[] = [];
  const restore = installPageGlobals(player, cassette, fetched);
  try {
    // The connector paces its receipt requests 300ms apart, which is fifteen seconds of real
    // waiting for a full budget. Fake timers turn that into nothing, and draining them alongside
    // the promise is what lets the paced chain run to completion.
    const pending = __test__.extractOperationsInPage({
      windowFromIso: new Date(windowFromMs).toISOString(),
      sessionId: "REDACTED",
      parseStrategy: "fast",
    });
    await vi.runAllTimersAsync();
    const extraction = await pending;
    return { extraction, player, fetched };
  } finally {
    // Order matters. `installPageGlobals` captured the `performance` object that fake timers had
    // already replaced, so restoring after `useRealTimers()` writes the fake-timer
    // `getEntriesByType` onto the real object — leaking a mocked resource timeline into every
    // later cassette and every later test in this worker, where endpoint discovery would quietly
    // resolve against it.
    restore();
    vi.useRealTimers();
  }
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const hasText = (value: unknown): boolean => typeof value === "string" && value.trim().length > 0;

const isHttpUrl = (value: unknown): boolean => {
  if (!hasText(value)) return false;
  try {
    return /^https?:$/i.test(new URL(value as string).protocol);
  } catch {
    return false;
  }
};

const isFiniteNumber = (value: unknown): boolean =>
  typeof value === "number" && Number.isFinite(value);

/** The receipt items as the mapper finds them, through both shapes it accepts. */
function receiptItemsOf(record: Record<string, unknown>): unknown[] {
  const shoppingReceipt = asRecord(record.shoppingReceipt);
  const receipt =
    asRecord(asRecord(shoppingReceipt?.payload)?.receipt) ?? asRecord(shoppingReceipt?.receipt);
  return Array.isArray(receipt?.items) ? (receipt.items as unknown[]) : [];
}

/**
 * A field the mapper derives from the recording: where the value comes from, and where it is
 * supposed to end up.
 *
 * The table exists instead of a list of one-off assertions because the failure it guards against
 * is a class, not a field. An over-eager scrub, a mapper that stops reading a key, a response
 * shape that moves one — all three look the same from here: something the recording carries that
 * the row no longer does. Adding the next derived field is one entry.
 */
interface EnrichedSurface {
  name: string;
  /**
   * The endpoint whose recorded response this surface is derived from. A cassette that never
   * captured that endpoint cannot check the surface, and saying which one it is here is what
   * separates "this recording does not cover it" from "this recording lost it" — the second is
   * a failure and the first is not.
   */
  derivedFrom: string;
  /** True when the recorded input carries what this surface is derived from. */
  recorded: (record: Record<string, unknown>, row: Record<string, unknown>) => boolean;
  /** True when the mapped row exposes it. */
  mapped: (row: Record<string, unknown>) => boolean;
}

const OPERATIONS_PATH = "/api/common/v1/operations";
const OPERATION_DETAIL_PATH = "/api/common/v1/operation";
const SHOPPING_RECEIPT_PATH = "/api/common/v1/shopping_receipt";
const TRANCHE_OFFERS_PATH = "/api/common/v1/tranche_offers";

const operationOf = (record: Record<string, unknown>) => asRecord(record.operation) ?? {};
const brandOf = (record: Record<string, unknown>) => asRecord(operationOf(record).brand);
const sourceBrandOf = (row: Record<string, unknown>) => asRecord(row.source_brand);

const ENRICHED_SURFACES: EnrichedSurface[] = [
  {
    // `source_brand` is dropped whole for the bank's own labels ("внутрибанковский перевод" and
    // the rest), so each brand surface is conditioned on the row having kept the brand at all —
    // otherwise every transfer in the recording would read as a lost enrichment.
    name: "source_brand.website_url",
    derivedFrom: OPERATIONS_PATH,
    recorded: (record, row) => sourceBrandOf(row) !== null && isHttpUrl(brandOf(record)?.link),
    mapped: (row) => sourceBrandOf(row)?.website_url != null,
  },
  {
    name: "source_brand.logo_url",
    derivedFrom: OPERATIONS_PATH,
    recorded: (record, row) =>
      sourceBrandOf(row) !== null &&
      (isHttpUrl(brandOf(record)?.logo) || isHttpUrl(brandOf(record)?.fileLink)),
    mapped: (row) => sourceBrandOf(row)?.logo_url != null,
  },
  {
    name: "source_brand.base_color",
    derivedFrom: OPERATIONS_PATH,
    recorded: (record, row) => sourceBrandOf(row) !== null && hasText(brandOf(record)?.baseColor),
    mapped: (row) => sourceBrandOf(row)?.base_color != null,
  },
  {
    name: "source_category",
    derivedFrom: OPERATIONS_PATH,
    recorded: (record) => {
      const bankCategory = asRecord(asRecord(operationOf(record).categoryInfo)?.bankCategory);
      return hasText(bankCategory?.id) || hasText(bankCategory?.name);
    },
    mapped: (row) => asRecord(row.source_category) !== null,
  },
  {
    name: "operation_icon_url",
    derivedFrom: OPERATIONS_PATH,
    recorded: (record) => isHttpUrl(operationOf(record).icon),
    mapped: (row) => row.operation_icon_url != null,
  },
  {
    name: "mcc",
    derivedFrom: OPERATIONS_PATH,
    recorded: (record) => {
      const operation = operationOf(record);
      const candidates = [
        operation.mccString,
        operation.mcc,
        asRecord(asRecord(operation.merchant)?.mcc)?.value,
      ];
      return candidates.some((candidate) => /\d{3,4}/.test(String(candidate ?? "")));
    },
    mapped: (row) => row.mcc != null,
  },
  {
    name: "cashback_amount",
    derivedFrom: OPERATIONS_PATH,
    recorded: (record) => {
      const operation = operationOf(record);
      if (isFiniteNumber(asRecord(operation.loyaltyBonusSummary)?.amount)) return true;
      if (isFiniteNumber(asRecord(operation.cashbackAmount)?.value)) return true;
      if (isFiniteNumber(operation.cashback)) return true;
      const bonuses = Array.isArray(operation.loyaltyBonus) ? operation.loyaltyBonus : [];
      return bonuses.some((bonus) => isFiniteNumber(asRecord(asRecord(bonus)?.amount)?.value));
    },
    mapped: (row) => row.cashback_amount != null,
  },
  {
    name: "receipt_tracking_id",
    derivedFrom: SHOPPING_RECEIPT_PATH,
    recorded: (record) => hasText(asRecord(record.shoppingReceipt)?.trackingId),
    mapped: (row) => row.receipt_tracking_id != null,
  },
  {
    name: "comment",
    derivedFrom: OPERATIONS_PATH,
    recorded: (record) => {
      const operation = operationOf(record);
      const detail = asRecord(record.operationDetail);
      const payload = asRecord(detail?.payload);
      return [
        operation.message,
        operation.comment,
        payload?.message,
        payload?.comment,
        detail?.comment,
      ].some(hasText);
    },
    mapped: (row) => row.comment != null,
  },
  {
    name: "raw_payload.operation_detail",
    derivedFrom: OPERATION_DETAIL_PATH,
    recorded: (record) => asRecord(record.operationDetail) !== null,
    mapped: (row) => asRecord(asRecord(row.raw_payload)?.operation_detail) !== null,
  },
  {
    name: "raw_payload.tranche_offers",
    derivedFrom: TRANCHE_OFFERS_PATH,
    recorded: (record) => asRecord(record.trancheOffers) !== null,
    mapped: (row) => asRecord(asRecord(row.raw_payload)?.tranche_offers) !== null,
  },
];

describe("tbank-web response contract", () => {
  it("reports when there is nothing to check", () => {
    // Recording is manual, so an empty fixture directory is an expected state — but it must
    // be a visible one, not a suite that reports success having checked nothing.
    if (cassettes.length === 0) {
      console.warn(
        "No cassettes in test/fixtures/tbank/cassettes. Record one with " +
          "`just extension-debug-live tbank_web 10`, scrub it, and commit it.",
      );
    }
    expect(Array.isArray(cassettes)).toBe(true);
  });

  it("keeps identifier-less operations apart the way the connector does", () => {
    // The fallback the totals test uses has to be `buildOperationKey`'s, and it was the mapped
    // row's instead. T-Bank writes a purchase as a *positive* `accountAmount.value` with
    // `type: "Debit"`, so these two are two identities to the connector and one signed `-10`
    // once mapped: the totals test would have counted one where the recorded summary counts two
    // and rejected a cassette that is correct, on a response shape the connector supports.
    const debit = {
      operationTime: { milliseconds: 1_752_571_800_000 },
      accountAmount: { value: 10 },
      type: "Debit",
      description: "Пятёрочка",
    };
    const credit = { ...debit, accountAmount: { value: -10 }, type: "Credit" };
    expect(fallbackIdentity(debit)).not.toBe(fallbackIdentity(credit));

    // Same for the description: the mapper falls through to `merchant.name` and then to
    // "T-Bank operation", so two operations with no description of their own collapse there and
    // stay apart here.
    const noDescription = { ...debit, description: undefined, merchant: { name: "Лента" } };
    const otherNoDescription = { ...debit, description: undefined, merchant: { name: "Магнит" } };
    expect(fallbackIdentity(noDescription)).toBe(fallbackIdentity(otherNoDescription));
    expect(fallbackIdentity(noDescription)).toContain(":unknown");

    // Numeric strings are numbers to the connector's `toNum`. Without the same coercion here,
    // `"1787227199000"` fell through to `new Date("1787227199000")`, which does not parse it, and
    // two distinct operations collapsed into one `fallback:null:null:…`.
    const asStrings = {
      operationTime: { milliseconds: "1787227199000" },
      accountAmount: { value: "10" },
      description: "Пятёрочка",
    };
    const otherAsStrings = { ...asStrings, accountAmount: { value: "20" } };
    expect(fallbackIdentity(asStrings)).toBe("fallback:1787227199000:10:Пятёрочка");
    expect(fallbackIdentity(asStrings)).not.toBe(fallbackIdentity(otherAsStrings));
  });

  for (const cassette of cassettes) {
    const operationsEntries = cassette.entries.filter((entry) =>
      entry.url.includes("/api/common/v1/operations"),
    );

    it(`maps every operation in ${cassette.name} without dropping any`, () => {
      expect(operationsEntries.length, "cassette has no operations response").toBeGreaterThan(0);

      const dropped: string[] = [];
      let mapped = 0;
      for (const entry of operationsEntries) {
        const payload = (entry.body as { payload?: unknown[] })?.payload ?? [];
        for (const operation of payload) {
          const row = __test__.mapOperationRecordToRow({ operation }, { extractionMethod: "api" });
          if (row) mapped += 1;
          else dropped.push(JSON.stringify(operation).slice(0, 200));
        }
      }

      expect(dropped, `operations the mapper could not read: ${dropped.join(" | ")}`).toEqual([]);
      expect(mapped).toBeGreaterThan(0);
    });

    const summary = (cassette as { summary?: RecordedSummary }).summary;
    if (summary && summary.months.length > 0) {
      it(`reproduces the recorded totals for ${cassette.name}`, () => {
        // The recorder wrote these totals, and whoever recorded the cassette compared them with
        // the bank's own screen before committing it. That comparison happened once; this is
        // what makes it permanent. A mapper that starts reading fewer operations, or reads an
        // amount or a date differently, shows up here as a number that no longer matches —
        // which a count of successfully mapped rows cannot express.
        const totals = new Map<string, { operations: number; income: number; expense: number }>();

        // A capped range is recorded as the parent response *and* both halves, so the same
        // operation appears in several payloads. The recorder's totals deduplicate through the
        // connector's own operation key; totalling raw payload entries here would double-count
        // every dense cassette and fail against a mapper that is perfectly correct.
        const seen = new Set<string>();

        for (const entry of operationsEntries) {
          const payload =
            (entry.body as { payload?: Array<Record<string, unknown>> })?.payload ?? [];
          for (const operation of payload) {
            const row = __test__.mapOperationRecordToRow(
              { operation },
              { extractionMethod: "api" },
            );
            if (!row) continue;

            // The identity has to be the one the connector and the recorder both key by. An
            // operation carrying none of the three identifiers is kept by their shared
            // timestamp/amount fallback, so dropping it here counts it in the recorded summary
            // and not in this recomputation — a failure on a response shape the connector
            // explicitly supports.
            // `buildOperationKey`'s own precedence and its own idea of what counts as present:
            // it runs each candidate through `text`, so an empty string falls through to the next
            // one. `??` does not — an operation carrying `id: ""` would take that branch, and
            // every such operation would collapse to one identity while the connector keeps them
            // apart, undercounting the month and failing a cassette that is correct.
            const asKey = (value: unknown): string | null => {
              if (typeof value === "string") return value.trim() || null;
              if (typeof value === "number" && Number.isFinite(value)) return String(value);
              return null;
            };
            // Prefixed exactly as `buildOperationKey` prefixes them. Without the namespaces, one
            // operation's `id` equal to another's `operationId.value` or `authorizationId` is the
            // same identity here and two distinct identities to the connector — so the recorded
            // summary counts both, this loop counts one, and a correct cassette is rejected.
            const id = asKey(operation.id);
            const operationId = asKey(
              (operation.operationId as { value?: unknown } | undefined)?.value,
            );
            const authorizationId = asKey(operation.authorizationId);
            const identity =
              (id !== null ? `id:${id}` : null) ??
              (operationId !== null ? `operationId:${operationId}` : null) ??
              (authorizationId !== null ? `auth:${authorizationId}` : null) ??
              fallbackIdentity(operation);
            if (seen.has(identity)) continue;
            seen.add(identity);

            const postedAt = typeof row.posted_at === "string" ? row.posted_at : null;
            const amount = typeof row.amount === "number" ? row.amount : null;
            const currency = typeof row.currency === "string" ? row.currency : "RUB";
            if (postedAt === null || amount === null) continue;

            // `posted_at` is UTC; the summary buckets by Moscow month, because that is what
            // the bank's screen groups by and therefore what a person compares against. An
            // operation just after midnight in Moscow falls in the previous UTC month, so
            // slicing the UTC string here would move it and the totals would never agree.
            const month = new Date(Date.parse(postedAt) + MOSCOW_OFFSET_MS)
              .toISOString()
              .slice(0, 7);
            const key = `${month}|${currency}`;
            const bucket = totals.get(key) ?? { operations: 0, income: 0, expense: 0 };
            bucket.operations += 1;
            // Same convention as the recorder's summary: the bank subtracts a purchase refund
            // from that month's spending rather than counting it as income, and these totals
            // exist to be comparable with the bank's screen.
            const isRefund = amount > 0 && String(operation.group ?? "").toUpperCase() === "PAY";
            if (isRefund) bucket.expense -= amount;
            else if (amount >= 0) bucket.income += amount;
            else bucket.expense += Math.abs(amount);
            totals.set(key, bucket);
          }
        }

        for (const month of summary.months) {
          const bucket = totals.get(`${month.month}|${month.currency}`);
          expect(bucket, `no mapped rows for ${month.month} ${month.currency}`).toBeDefined();
          expect(bucket?.operations, `${month.month} operation count`).toBe(month.operations);
          expect(bucket?.income.toFixed(2), `${month.month} income`).toBe(month.income);
          expect(bucket?.expense.toFixed(2), `${month.month} expense`).toBe(month.expense);
        }
      });
    }

    it(`replays ${cassette.name} through the connector without a miss`, async () => {
      // Everything above reads the cassette and calls the mapper on what it finds. That checks
      // the mapping and nothing else: the range walk, the truncation splitting, the receipt
      // request key, the tranche parameters and the detail endpoint are all exercised only when
      // the connector itself does the asking. A recorder that drifts from any of them produces
      // a cassette that looks complete and replays as misses, which is precisely the failure
      // this whole arrangement exists to prevent — and it would pass every other test here.
      const { extraction, player, fetched } = await replayCassette(cassette);

      // A miss is the whole point: it means the connector asked for something the recorder
      // never recorded, so the offline path silently loses that enrichment in production.
      expect(player.misses, `player misses: ${player.misses.join(", ")}`).toEqual([]);
      expect(extraction.blocked_reason ?? null).toBeNull();
      // `mapping_drop_counts` is written into the debug payload at runtime but is not on its
      // declared type, so it is read positionally rather than by widening a shipped interface
      // for a test. Non-empty means the connector saw operations it could not map.
      const debugRecord = (extraction.debug ?? {}) as Record<string, unknown>;
      expect(debugRecord.mapping_drop_counts ?? {}).toEqual({});
      expect(extraction.parsed_transactions_count).toBeGreaterThan(0);

      // The receipt accounting is where recorder and connector have to agree most exactly:
      // the budget, which operations it is spent on, and what counts as a receipt. Derived
      // from this cassette rather than fixed, because a valid recording may hold fewer
      // receipts than the budget — the recorder says as much in a warning — and hard-coding
      // the dense month's fifty would fail every sparser cassette committed later.
      const recordedReceipts = cassette.entries.filter((entry) =>
        entry.url.includes("/api/common/v1/shopping_receipt"),
      ).length;
      const receiptDebug = extraction.debug?.receipt_enrichment;
      expect(receiptDebug?.requested_count).toBe(recordedReceipts);
      // Every issued request ends in exactly one of the two outcomes; which of them it is
      // depends on what the bank returned when the recording was made.
      expect((receiptDebug?.success_count ?? 0) + (receiptDebug?.failed_count ?? 0)).toBe(
        recordedReceipts,
      );

      // Recorded responses nothing asked for are the same drift seen from the other side:
      // the recorder captured requests the connector does not make.
      const unusedPaths = player.unused().map((entry) => new URL(entry.url).pathname);
      expect(unusedPaths, `unused: ${unusedPaths.join(", ")}`).toEqual([]);

      // Zero misses and zero unused entries still do not pin the request count. When a match
      // key runs out of entries the player hands back the first one again rather than
      // reporting a miss, so an extra range request — the very drift this test exists to
      // catch — would leave both those assertions green. Counting requests per key is what
      // closes that: the connector must ask for each key exactly as often as the recording
      // holds it.
      expect(requestsPerKey(fetched), "request count per endpoint").toEqual(
        requestsPerKey(cassette.entries.map((entry) => entry.url)),
      );

      // The count alone still does not pin the walk. `start` and `end` are excluded from the
      // match key on purpose — splitting legitimately re-asks for the same data with different
      // bounds — so a `buildRanges` that moved every boundary while making the same number of
      // calls would replay the recorded payloads against ranges nobody recorded, and every
      // assertion above would stay green. The bounds are compared here, in order, because the
      // player hands operations bodies back in recorded order and that order only means
      // anything if the ranges are the recorded ranges.
      const bounds = (urls: string[]) =>
        urls
          .filter((url) => url.includes("/api/common/v1/operations"))
          .map((url) => {
            const params = new URL(url).searchParams;
            return `${params.get("start")}..${params.get("end")}`;
          });
      expect(bounds(fetched), "range bounds, in order").toEqual(
        bounds(cassette.entries.map((entry) => entry.url)),
      );
    });

    it(`keeps every enrichment it fetched for ${cassette.name} once the rows are built`, async () => {
      // The replay proves the connector asked for the right things and got them back. It does
      // not prove any of it reaches a transaction: `extractOperationsInPage` returns raw
      // `operation_records`, and the mapping from record to row happens afterwards, in the
      // connector's runner. So a cassette that lost its receipt items, its brand links or its
      // category names — to an over-eager scrub, or to a mapper that stopped reading them —
      // replays with zero misses, zero unused entries and the recorded request sequence, and
      // leaves every assertion above green while producing rows with none of what the receipt
      // budget and the detail walk were spent on. This is the test that fails instead.
      const { extraction } = await replayCassette(cassette);
      const records = (extraction.operation_records ?? []) as unknown as Array<
        Record<string, unknown>
      >;
      expect(records.length, "the replay produced no operation records").toBeGreaterThan(0);

      const rows: Array<{ record: Record<string, unknown>; row: Record<string, unknown> }> = [];
      const dropped: string[] = [];
      for (const record of records) {
        const row = __test__.mapOperationRecordToRow(record, { extractionMethod: "api" }) as Record<
          string,
          unknown
        > | null;
        if (row) rows.push({ record, row });
        else dropped.push(JSON.stringify(record.operation ?? record).slice(0, 200));
      }
      // The same check the first test makes on raw payloads, made again on enriched records:
      // enrichment merges a detail response and a receipt into the record before mapping, and a
      // merge that mangles the operation drops a row the raw payload maps perfectly well.
      expect(dropped, `enriched records the mapper could not read: ${dropped.join(" | ")}`).toEqual(
        [],
      );

      // Receipt line items are what the whole receipt budget is spent on, and the one
      // enrichment with a fallback: a row whose receipt was lost still gets a single line item
      // standing in for the transaction, so counting rows that have line items proves nothing.
      // Every recorded item has to reach the row it belongs to.
      let recordsWithReceiptItems = 0;
      for (const { record, row } of rows) {
        const items = receiptItemsOf(record);
        if (items.length === 0) continue;
        recordsWithReceiptItems += 1;

        const lineItems = (Array.isArray(row.line_items) ? row.line_items : []) as Array<
          Record<string, unknown>
        >;
        const label = String(row.external_id ?? row.posted_at);
        expect(lineItems.length, `line items for ${label}`).toBe(items.length);
        for (const lineItem of lineItems) {
          expect(hasText(lineItem.title), `line item title for ${label}`).toBe(true);
          expect(isFiniteNumber(lineItem.amount), `line item amount for ${label}`).toBe(true);
          // Signs have to agree with the transaction, or summing a purchase by its line items
          // turns an expense into income.
          const sameDirection =
            lineItem.amount === 0 ||
            Math.sign(lineItem.amount as number) === Math.sign(row.amount as number);
          expect(sameDirection, `line item direction for ${label}`).toBe(true);
        }
        expect(row.receipt_enrichment_status, `receipt status for ${label}`).toBe("ok");
        expect(row.receipt_line_items_skipped, `receipt skipped flag for ${label}`).toBe(false);
      }
      // Same rule the surfaces table uses below, and for the same reason. A window whose
      // operations carry no receipts is a valid recording — the recorder says so with a warning
      // rather than refusing the download — and failing here would make that cassette
      // unusable by construction. But a cassette that *did* record receipt responses and yields
      // no items from any of them is the scrub-damage shape, and that fails.
      if (cassette.entries.some((entry) => entry.url.includes(SHOPPING_RECEIPT_PATH))) {
        expect(
          recordsWithReceiptItems,
          "receipts were recorded and not one produced a line item — the budget bought nothing",
        ).toBeGreaterThan(0);
      } else {
        console.warn(`${cassette.name} cannot check receipt line items: it recorded no receipts`);
      }

      // Every other derived field, through the table. A surface present in the recording and
      // missing from the row is a lost enrichment whatever the cause.
      const recordedPaths = new Set(cassette.entries.map((entry) => new URL(entry.url).pathname));
      const lost: string[] = [];
      const uncovered: string[] = [];
      const notRecorded: string[] = [];
      for (const surface of ENRICHED_SURFACES) {
        // Nothing to say about a field whose endpoint this recording never captured: the
        // connector could not have asked for it, so its absence from every row is correct.
        if (!recordedPaths.has(surface.derivedFrom)) {
          notRecorded.push(`${surface.name} (no ${surface.derivedFrom} in the recording)`);
          continue;
        }
        let present = 0;
        let exposed = 0;
        for (const { record, row } of rows) {
          if (!surface.recorded(record, row)) continue;
          present += 1;
          if (surface.mapped(row)) exposed += 1;
        }
        if (present === 0) uncovered.push(surface.name);
        else if (exposed !== present) {
          lost.push(`${surface.name}: ${present - exposed} of ${present} rows lost it`);
        }
      }
      expect(lost, "recorded in the cassette, missing from the mapped row").toEqual([]);
      // The endpoint is in the recording and not one response carried the field: that is a
      // surface this cassette should have covered and does not — and it is exactly the shape a
      // wholesale redaction takes, which is why it fails rather than passing quietly.
      expect(uncovered, "the endpoint was recorded but no record carried these").toEqual([]);
      // Said out loud rather than skipped in silence, so the gap in a cassette's coverage is
      // visible to whoever records the next one.
      if (notRecorded.length > 0) {
        console.warn(`${cassette.name} cannot check: ${notRecorded.join(", ")}`);
      }
    });

    it(`keeps every field the row mapping depends on in ${cassette.name}`, () => {
      for (const entry of operationsEntries) {
        const payload = (entry.body as { payload?: Array<Record<string, unknown>> })?.payload ?? [];
        for (const operation of payload) {
          // All three the connector keys by, not two. `buildOperationKey` falls through
          // `id` → `operationId.value` → `authorizationId` and then to a timestamp/amount
          // fallback, so an operation carrying only `authorizationId` — or none of the three —
          // is one the connector handles and this used to reject, failing a cassette for holding
          // a shape the connector explicitly supports. The fallback needs the time and the
          // amount, and those are asserted on the next two lines, so nothing here is unchecked.
          const identity =
            operation.id ??
            (operation.operationId as { value?: unknown } | undefined)?.value ??
            operation.authorizationId;
          const hasFallback =
            (operation.operationTime ?? operation.debitingTime ?? operation.operationDateTime) !==
              undefined && (operation.accountAmount ?? operation.amount) !== undefined;
          expect(
            identity !== undefined || hasFallback,
            "operation identity: none of id/operationId/authorizationId, and no timestamp and " +
              "amount for the fallback either",
          ).toBe(true);
          expect(
            operation.operationTime ?? operation.debitingTime ?? operation.operationDateTime,
            "operation time",
          ).toBeDefined();
          expect(operation.accountAmount ?? operation.amount, "operation amount").toBeDefined();
          // The mapper's own chain for the merchant label: `description`, then `merchant.name`,
          // then `subgroup.name`. `brand` was never in it, and two shapes that are were missing —
          // so this rejected a recording the connector maps without complaint. It stays an
          // assertion rather than going away because the mapper defaults to "T-Bank operation",
          // which turns a recording that lost its merchant text into one that silently maps.
          const merchantLabel =
            operation.description ??
            (operation.merchant as { name?: unknown } | undefined)?.name ??
            (operation.subgroup as { name?: unknown } | undefined)?.name;
          expect(merchantLabel, "operation merchant label").toBeDefined();
        }
      }
    });
  }
});
