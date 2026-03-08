// deno-lint-ignore-file require-await
import { assertEquals } from "std/assert/assert-equals";
import { callOpenRouterParse, parseStructuredFromLlmContent } from "./openrouter-parse.ts";
import type { OpenRouterParseContext } from "./openrouter-parse.ts";

const emptyContext: OpenRouterParseContext = {
  observationCatalog: [],
  findingTypeCatalog: [],
  bodySiteCatalog: [],
  existingConditions: [],
  existingFindings: [],
  checkupItems: [],
};

Deno.test("parseStructuredFromLlmContent parses direct JSON", () => {
  const structured = parseStructuredFromLlmContent(
    JSON.stringify({
      record_type: "lab",
      title: "CBC",
      summary: "ok",
      keywords: ["cbc"],
      observations: [{ obs_name: "Hemoglobin", value: "120", confidence: 0.9 }],
    }),
  );

  assertEquals(structured.record_type, "lab");
  assertEquals(structured.title, "CBC");
  assertEquals(structured.observations.length, 1);
  assertEquals(structured.observations[0].obs_name, "Hemoglobin");
});

Deno.test("parseStructuredFromLlmContent parses fenced JSON and normalizes fallback type", () => {
  const structured = parseStructuredFromLlmContent(
    '```json\n{"record_type":"unsupported","title":"Echo"}\n```',
  );
  assertEquals(structured.record_type, "other");
  assertEquals(structured.title, "Echo");
});

Deno.test("parseStructuredFromLlmContent falls back on invalid content", () => {
  const structured = parseStructuredFromLlmContent("not-json");
  assertEquals(structured.record_type, "other");
  assertEquals(structured.observations.length, 0);
  assertEquals(structured.findings.length, 0);
});

Deno.test("callOpenRouterParse sends request and parses string content", async () => {
  let requestBody: Record<string, unknown> | null = null;
  const fetchFn: typeof fetch = (async (_input, init) => {
    requestBody = JSON.parse(
      String((init as { body?: BodyInit | null } | undefined)?.body ?? "{}"),
    );
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                record_type: "visit",
                title: "Visit note",
                observations: [],
                findings: [],
                conditions: [],
                findings_to_resolve: [],
                conditions_to_resolve: [],
                checkups_to_complete: [],
                keywords: [],
                summary: "",
                record_date: null,
              }),
            },
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;

  const structured = await callOpenRouterParse("text", emptyContext, {
    fetchFn,
    apiKey: "key",
  });

  assertEquals(structured.record_type, "visit");
  assertEquals(asRecord(requestBody)?.model, "openai/gpt-4o-mini");
});

Deno.test("callOpenRouterParse handles non-OK responses", async () => {
  const fetchFn: typeof fetch = (async () => {
    return new Response("bad gateway", { status: 502 });
  }) as typeof fetch;

  let caught: unknown = null;
  try {
    await callOpenRouterParse("text", emptyContext, {
      fetchFn,
      apiKey: "key",
    });
  } catch (error) {
    caught = error;
  }

  assertEquals((caught as Error).message, "OpenRouter request failed: 502");
});

Deno.test("callOpenRouterParse parses array content fallback", async () => {
  const fetchFn: typeof fetch = (async () => {
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: [
                {
                  type: "text",
                  text: '{"record_type":"lab","title":"Panel","observations":[],"findings":[],"conditions":[],"findings_to_resolve":[],"conditions_to_resolve":[],"checkups_to_complete":[],"keywords":[],"summary":"","record_date":null}',
                },
              ],
            },
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;

  const structured = await callOpenRouterParse("text", emptyContext, {
    fetchFn,
    apiKey: "key",
  });

  assertEquals(structured.record_type, "lab");
  assertEquals(structured.title, "Panel");
});

Deno.test("parseStructuredFromLlmContent normalizes primitive and nullable branches", () => {
  const structured = parseStructuredFromLlmContent(
    JSON.stringify({
      record_type: "lab",
      title: "Doc",
      observations: [
        {
          obs_name: "Obs",
          value_numeric: "12.5",
          ref_range_low: "bad",
          ref_range_high: "25.5",
          status: "normal",
          confidence: "0.8",
        },
      ],
      findings: [
        {
          finding_type_text: "Finding",
          body_site_text: "   ",
          source_anchor: 42,
        },
      ],
      conditions: [
        {
          name: 123,
          source_anchor: "   ",
        },
      ],
    }),
  );

  assertEquals(structured.observations[0].value_numeric, 12.5);
  assertEquals(structured.observations[0].ref_range_low, null);
  assertEquals(structured.observations[0].ref_range_high, 25.5);
  assertEquals(structured.observations[0].confidence, 0.8);
  assertEquals(structured.findings[0].body_site_text, null);
  assertEquals(structured.findings[0].source_anchor, "");
  assertEquals(structured.conditions[0].name, "");
  assertEquals(structured.conditions[0].source_anchor, null);
});

Deno.test("callOpenRouterParse logs and rethrows fetch errors", async () => {
  const logs: string[] = [];
  const fetchFn: typeof fetch = (async () => {
    throw new Error("network exploded");
  }) as typeof fetch;

  let caught: unknown = null;
  try {
    await callOpenRouterParse("text", emptyContext, {
      fetchFn,
      apiKey: "key",
      log: {
        log: () => {},
        error: (...args: unknown[]) => {
          logs.push(args.map((arg) => String(arg)).join(" "));
        },
      },
    });
  } catch (error) {
    caught = error;
  }

  assertEquals((caught as Error).message, "network exploded");
  assertEquals(logs.length > 0, true);
});

Deno.test("callOpenRouterParse maps aborts to timeout error", async () => {
  const fetchFn: typeof fetch = ((_input, init) =>
    new Promise((_resolve, reject) => {
      const signal = (init as { signal?: AbortSignal } | undefined)?.signal;
      signal?.addEventListener("abort", () => {
        reject(new DOMException("The signal has been aborted", "AbortError"));
      });
    })) as typeof fetch;

  let caught: unknown = null;
  try {
    await callOpenRouterParse("text", emptyContext, {
      fetchFn,
      apiKey: "key",
      timeoutMs: 1,
    });
  } catch (error) {
    caught = error;
  }

  assertEquals((caught as Error).message, "OpenRouter request timed out");
});

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object") return value as Record<string, unknown>;
  return {};
}
