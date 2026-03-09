import type {
  BodySiteCatalogItem,
  CheckupItemForContext,
  ExistingCondition,
  ExistingFinding,
  FindingTypeCatalogItem,
  ObservationCatalogItem,
  StructuredDataWithEntities,
} from "./types.ts";

const ALLOWED_RECORD_TYPES = new Set([
  "lab",
  "visit",
  "imaging",
  "prescription",
  "vaccination",
  "vet",
  "procedure",
  "other",
]);

export interface OpenRouterParseContext {
  observationCatalog: ObservationCatalogItem[];
  findingTypeCatalog: FindingTypeCatalogItem[];
  bodySiteCatalog: BodySiteCatalogItem[];
  existingConditions: ExistingCondition[];
  existingFindings: ExistingFinding[];
  checkupItems: CheckupItemForContext[];
}

export interface OpenRouterParseDeps {
  fetchFn: typeof fetch;
  apiKey: string;
  model?: string;
  timeoutMs?: number;
  log?: Pick<Console, "log" | "error">;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_OPENROUTER_MODEL = "openai/gpt-5.2:nitro";
const INVALID_JSON_ERROR_MESSAGE = "OpenRouter returned invalid JSON content";

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object") return value as Record<string, unknown>;
  return {};
}

function asString(value: unknown, fallback = ""): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function asNullableString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function parseStructuredFromLlmContent(content: string): StructuredDataWithEntities {
  const trimmed = content.trim();
  const candidates: string[] = [];

  if (trimmed.length > 0) candidates.push(trimmed);

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) candidates.push(fenced[1].trim());

  for (const candidate of candidates) {
    try {
      const parsed = asObject(JSON.parse(candidate));
      return normalizeStructuredOutput(parsed);
    } catch {
      continue;
    }
  }

  throw new Error(INVALID_JSON_ERROR_MESSAGE);
}

function normalizeObservation(item: unknown) {
  const obj = asObject(item);
  const obsName = asNullableString(obj.obs_name);
  if (!obsName) return null;

  return {
    obs_code: asNullableString(obj.obs_code),
    obs_name: obsName,
    value: asString(obj.value, ""),
    value_numeric: asNumber(obj.value_numeric),
    unit: asNullableString(obj.unit),
    ref_range: asNullableString(obj.ref_range),
    ref_range_low: asNumber(obj.ref_range_low),
    ref_range_high: asNumber(obj.ref_range_high),
    status: asNullableString(obj.status) as
      | "normal"
      | "low"
      | "high"
      | "critical_low"
      | "critical_high"
      | "unknown"
      | null,
    confidence: asNumber(obj.confidence) ?? 0,
  };
}

function normalizeFinding(item: unknown) {
  const obj = asObject(item);
  const findingTypeText = asNullableString(obj.finding_type_text);
  const sourceAnchor = asNullableString(obj.source_anchor);
  if (!findingTypeText || !sourceAnchor) return null;

  return {
    finding_code: asNullableString(obj.finding_code),
    finding_type_text: findingTypeText,
    site_code: asNullableString(obj.site_code),
    body_site_text: asNullableString(obj.body_site_text),
    size_mm: asNumber(obj.size_mm),
    count: asNumber(obj.count),
    severity: (asNullableString(obj.severity) ?? "unknown") as
      | "mild"
      | "moderate"
      | "severe"
      | "unknown",
    laterality: (asNullableString(obj.laterality) ?? "none") as
      | "left"
      | "right"
      | "bilateral"
      | "none",
    morphology: asNullableString(obj.morphology),
    description: asNullableString(obj.description),
    histology: asNullableString(obj.histology),
    finding_date: asNullableString(obj.finding_date),
    source_anchor: sourceAnchor,
    confidence: asNumber(obj.confidence) ?? 0,
  };
}

function normalizeStructuredOutput(raw: Record<string, unknown>): StructuredDataWithEntities {
  const recordTypeRaw = asString(raw.record_type, "other").toLowerCase();
  const recordType = ALLOWED_RECORD_TYPES.has(recordTypeRaw) ? recordTypeRaw : "other";
  const normalized: StructuredDataWithEntities = {
    record_type: recordType,
    title: asString(raw.title, "Medical document"),
    record_date: asNullableString(raw.record_date),
    summary: asString(raw.summary, ""),
    keywords: asStringArray(raw.keywords),
    observations: asArray(raw.observations)
      .map(normalizeObservation)
      .filter((item) => item !== null),
    findings: asArray(raw.findings)
      .map(normalizeFinding)
      .filter((item) => item !== null),
    conditions: asArray(raw.conditions).map((item) => {
      const obj = asObject(item);
      return {
        existing_condition_id: asNullableString(obj.existing_condition_id),
        name: asString(obj.name, ""),
        icd_code: asNullableString(obj.icd_code),
        status: (asNullableString(obj.status) ?? "suspected") as
          | "active"
          | "resolved"
          | "suspected"
          | "history",
        confidence: asNumber(obj.confidence) ?? 0,
        source_anchor: asNullableString(obj.source_anchor),
      };
    }),
    findings_to_resolve: asArray(raw.findings_to_resolve).map((item) => {
      const obj = asObject(item);
      return {
        finding_code: asNullableString(obj.finding_code),
        finding_type_text: asString(obj.finding_type_text, ""),
        site_code: asNullableString(obj.site_code),
        body_site_text: asNullableString(obj.body_site_text),
        reason: asString(obj.reason, ""),
        source_anchor: asString(obj.source_anchor, ""),
        confidence: asNumber(obj.confidence) ?? 0,
      };
    }),
    conditions_to_resolve: asArray(raw.conditions_to_resolve).map((item) => {
      const obj = asObject(item);
      return {
        condition_id: asString(obj.condition_id, ""),
        reason: asString(obj.reason, ""),
        source_anchor: asString(obj.source_anchor, ""),
        confidence: asNumber(obj.confidence) ?? 0,
      };
    }),
    checkups_to_complete: asArray(raw.checkups_to_complete).map((item) => {
      const obj = asObject(item);
      return {
        checkup_item_id: asString(obj.checkup_item_id, ""),
        reason: asString(obj.reason, ""),
        suggested_done_at: asString(obj.suggested_done_at, ""),
      };
    }),
  };

  return normalized;
}

function buildPrompt(ocrText: string, context: OpenRouterParseContext): string {
  const briefContext = {
    catalog_counts: {
      observations: context.observationCatalog.length,
      finding_types: context.findingTypeCatalog.length,
      body_sites: context.bodySiteCatalog.length,
    },
    existing_conditions: context.existingConditions.map((item) => ({
      id: item.id,
      name: item.name,
      code: item.code,
      status: item.current_status,
    })),
    existing_findings: context.existingFindings.map((item) => ({
      finding_code: item.finding_code,
      finding_type_text: item.finding_type_text,
      site_code: item.site_code,
      body_site_text: item.body_site_text,
    })),
    checkup_items: context.checkupItems.map((item) => ({
      id: item.id,
      title: item.title,
      next_due_at: item.next_due_at,
    })),
  };

  return [
    "Extract structured medical information from OCR text.",
    "Return STRICT JSON with fields:",
    "record_type,title,record_date,summary,keywords,observations,findings,conditions,findings_to_resolve,conditions_to_resolve,checkups_to_complete",
    "Use only facts explicitly present in OCR text.",
    "Never emit placeholder labels such as Unknown observation or Unknown finding.",
    "If an observation or finding label is uncertain, omit that entity instead of guessing.",
    "Only include source anchors when you can quote a real text snippet from OCR text.",
    `Context: ${JSON.stringify(briefContext)}`,
    `OCR_TEXT:\n${ocrText}`,
  ].join("\n\n");
}

export async function callOpenRouterParse(
  ocrText: string,
  context: OpenRouterParseContext,
  deps: OpenRouterParseDeps,
): Promise<StructuredDataWithEntities> {
  const controller = new AbortController();
  const timeout = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await deps.fetchFn("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${deps.apiKey}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: deps.model ?? DEFAULT_OPENROUTER_MODEL,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You are a clinical extraction engine. Output valid JSON only. Never invent placeholder labels or unsupported medical codes.",
          },
          {
            role: "user",
            content: buildPrompt(ocrText, context),
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenRouter request failed: ${response.status}`);
    }

    const body = asObject(await response.json());
    const choices = asArray(body.choices);
    const firstChoice = asObject(choices[0]);
    const message = asObject(firstChoice.message);
    const content = message.content;

    let contentText = "";
    if (typeof content === "string") {
      contentText = content;
    } else if (Array.isArray(content)) {
      contentText = content
        .map((part) => asString(asObject(part).text))
        .filter((part) => part.length > 0)
        .join("\n");
    }

    const raw = (() => {
      const t = contentText.trim();
      const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
      const candidate = fenced?.[1]?.trim() ?? t;
      try {
        return asObject(JSON.parse(candidate));
      } catch {
        return null;
      }
    })();
    const rawObs = raw ? asArray(raw.observations) : [];
    const rawFindings = raw ? asArray(raw.findings) : [];
    const structured = parseStructuredFromLlmContent(contentText);
    console.log(
      JSON.stringify({
        health_structure_llm_debug: true,
        response_length: contentText.length,
        raw_response: contentText,
        raw_observations_count: rawObs.length,
        raw_findings_count: rawFindings.length,
        normalized_observations_count: structured.observations.length,
        normalized_findings_count: structured.findings.length,
        raw_observation_names: rawObs
          .slice(0, 20)
          .map((o) => asString(asObject(o).obs_name) ?? "(missing)"),
      }),
    );
    return structured;
  } catch (error) {
    if ((error as { name?: string }).name === "AbortError") {
      const timeoutError = new Error("OpenRouter request timed out");
      deps.log?.error?.("OpenRouter parse failed:", timeoutError);
      throw timeoutError;
    }
    deps.log?.error?.("OpenRouter parse failed:", error);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
