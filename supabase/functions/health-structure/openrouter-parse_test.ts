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

Deno.test("parseStructuredFromLlmContent throws on invalid content", () => {
  assertThrowsWithMessage(
    () => parseStructuredFromLlmContent("not-json"),
    "OpenRouter returned invalid JSON content",
  );
});

Deno.test(
  "parseStructuredFromLlmContent drops observations and findings without meaningful labels",
  () => {
    const structured = parseStructuredFromLlmContent(
      JSON.stringify({
        record_type: "lab",
        title: "CBC",
        observations: [
          { obs_code: "HGB", obs_name: "Hemoglobin", value: "120", confidence: 0.9 },
          { obs_code: "GLU", obs_name: "   ", value: "5.2", confidence: 0.8 },
          { obs_code: "ALT", confidence: 0.6 },
        ],
        findings: [
          { finding_type_text: "Nodule", source_anchor: "line 1" },
          { finding_type_text: "   ", source_anchor: "line 2" },
          { source_anchor: "line 3" },
        ],
      }),
    );

    assertEquals(structured.observations.length, 1);
    assertEquals(structured.observations[0].obs_name, "Hemoglobin");
    assertEquals(structured.findings.length, 1);
    assertEquals(structured.findings[0].finding_type_text, "Nodule");
  },
);

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
  assertEquals(asRecord(requestBody)?.model, "openai/gpt-5.2:nitro");
  assertEquals(asRecord(requestBody)?.response_format, { type: "json_object" });
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
          source_anchor: "line 1",
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
  assertEquals(structured.findings[0].source_anchor, "line 1");
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

Deno.test("callOpenRouterParse rejects invalid JSON model output", async () => {
  const fetchFn: typeof fetch = (async () => {
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: "not-json",
            },
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;

  await assertRejectsWithMessage(
    () =>
      callOpenRouterParse("text", emptyContext, {
        fetchFn,
        apiKey: "key",
      }),
    "OpenRouter returned invalid JSON content",
  );
});

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object") return value as Record<string, unknown>;
  return {};
}

function assertThrowsWithMessage(fn: () => unknown, message: string): void {
  let caught: unknown = null;
  try {
    fn();
  } catch (error) {
    caught = error;
  }

  assertEquals((caught as Error | null)?.message, message);
}

async function assertRejectsWithMessage(
  fn: () => Promise<unknown>,
  message: string,
): Promise<void> {
  let caught: unknown = null;
  try {
    await fn();
  } catch (error) {
    caught = error;
  }

  assertEquals((caught as Error | null)?.message, message);
}

function captureLog() {
  const lines: string[] = [];
  return {
    lines,
    log: {
      log: (...args: unknown[]) => lines.push(args.map(String).join(" ")),
      error: () => {},
    },
  };
}

function okResponse(payload: unknown): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] }),
    {
      status: 200,
    },
  );
}

const PATIENT_PAYLOAD = {
  record_type: "lab",
  title: "CBC",
  summary: "Iron deficiency anaemia suspected",
  keywords: ["anaemia"],
  record_date: "2026-01-05",
  observations: [
    { obs_name: "Гемоглобин", value: "97", unit: "g/L", status: "low", confidence: 0.9 },
  ],
  findings: [],
  conditions: [{ name: "Anaemia", icd_code: "D50.9", source_anchor: "Hb 97" }],
  findings_to_resolve: [],
  conditions_to_resolve: [],
  checkups_to_complete: [],
};

Deno.test("callOpenRouterParse never writes patient data to logs by default", async () => {
  const captured = captureLog();
  await callOpenRouterParse("Hb 97 g/L", emptyContext, {
    fetchFn: async () => okResponse(PATIENT_PAYLOAD),
    apiKey: "k",
    log: captured.log,
  });

  const all = captured.lines.join("\n");
  // Shape is logged...
  assertEquals(all.includes("health_structure_llm_shape"), true);
  assertEquals(all.includes('"normalized_observations_count":1'), true);
  // ...but nothing identifying is.
  assertEquals(all.includes("raw_response"), false);
  assertEquals(all.includes("Гемоглобин"), false);
  assertEquals(all.includes("Anaemia"), false);
  assertEquals(all.includes("D50.9"), false);
  assertEquals(all.includes("Iron deficiency"), false);
  assertEquals(all.includes("97"), false);
});

Deno.test(
  "callOpenRouterParse logs the raw payload only behind the explicit debug flag",
  async () => {
    const captured = captureLog();
    await callOpenRouterParse("Hb 97 g/L", emptyContext, {
      fetchFn: async () => okResponse(PATIENT_PAYLOAD),
      apiKey: "k",
      log: captured.log,
      debugRawPayload: true,
    });

    const all = captured.lines.join("\n");
    assertEquals(all.includes("health_structure_llm_raw_payload"), true);
    assertEquals(all.includes("Anaemia"), true);
  },
);
