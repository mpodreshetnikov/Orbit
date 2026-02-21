import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { corsHeaders } from "../_shared/cors.ts";
import type { Database, Json } from "../_shared/database.types.ts";

/**
 * health-structure: Text LLM function for structured data extraction
 *
 * This is step 2 of the medical record processing pipeline.
 * It extracts structured data (title, type, date, summary, keywords) from OCR text.
 * It also extracts observations/lab values using the observation catalog.
 * It also extracts findings (polyps, stones, cysts, etc.) using finding and body site catalogs.
 *
 * Flow: Upload -> health-ocr -> OCR Review -> [health-structure] -> Structure Review -> Save
 */

const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

/** Record types allowed by DB enum - normalize LLM output to avoid constraint errors */
const ALLOWED_RECORD_TYPES = [
  "lab",
  "visit",
  "imaging",
  "prescription",
  "vaccination",
  "vet",
  "procedure",
  "other",
] as const;

interface StructureRequest {
  record_id: string;
}

interface StructuredData {
  record_type: string;
  title: string;
  record_date: string | null;
  summary: string;
  keywords: string[];
}

interface ExtractedObservation {
  obs_code: string | null;
  obs_name: string;
  value: string;
  value_numeric: number | null;
  unit: string | null;
  ref_range: string | null;
  ref_range_low: number | null;
  ref_range_high: number | null;
  status: "normal" | "low" | "high" | "critical_low" | "critical_high" | "unknown" | null;
  confidence: number;
}

interface ExtractedFinding {
  finding_code: string | null;
  finding_type_text: string;
  site_code: string | null;
  body_site_text: string | null;
  size_mm: number | null;
  count: number | null;
  severity: "mild" | "moderate" | "severe" | "unknown";
  laterality: "left" | "right" | "bilateral" | "none";
  morphology: string | null;
  description: string | null;
  histology: string | null;
  finding_date: string | null;
  source_anchor: string;
  confidence: number;
}

interface ObservationCatalogItem {
  id: string;
  obs_code: string;
  name_ru: string;
  name_en: string;
  canonical_unit: string;
  synonyms_ru: string[];
  synonyms_en: string[];
  accepted_units: Record<string, { factor_to_canonical?: number; formula_to_canonical?: string }>;
}

interface FindingTypeCatalogItem {
  id: string;
  finding_code: string;
  name_ru: string;
  name_en: string;
  synonyms_ru: string[];
  synonyms_en: string[];
}

interface BodySiteCatalogItem {
  id: string;
  site_code: string;
  name_ru: string;
  name_en: string;
  parent_site_code: string | null;
  synonyms_ru: string[];
  synonyms_en: string[];
}

interface ExtractedCondition {
  existing_condition_id: string | null; // ID from existing conditions list
  name: string; // Name (required for new, optional for existing)
  icd_code: string | null; // ICD-10 code (e.g., "D50.9", "E11.9")
  status: "active" | "resolved" | "suspected" | "history";
  confidence: number;
  source_anchor: string | null;
}

interface IcdLookupResult {
  code: string;
  name_en: string | null;
  name_ru: string | null;
  found: boolean;
}

interface ExistingCondition {
  id: string;
  name: string;
  code: string | null; // ICD-10 code
  current_status: string;
  onset_date: string | null;
  resolved_date: string | null;
}

// Existing active finding for a person (aggregated by finding_code + site_code)
interface ExistingFinding {
  finding_code: string | null;
  finding_type_text: string;
  site_code: string | null;
  body_site_text: string | null;
  finding_type_id: string | null;
  body_site_id: string | null;
  latest_size_mm: number | null;
  latest_count: number | null;
  severity: string;
  latest_date: string | null;
}

// Finding that LLM determined should be marked as resolved
interface FindingToResolve {
  finding_code: string | null;
  finding_type_text: string;
  site_code: string | null;
  body_site_text: string | null;
  reason: string;
  source_anchor: string;
  confidence: number;
}

// Condition that LLM determined should be marked as resolved
interface ConditionToResolve {
  condition_id: string;
  reason: string;
  source_anchor: string;
  confidence: number;
}

// Checkup item for LLM context (upcoming/overdue)
interface CheckupItemForContext {
  id: string;
  title: string;
  category: string;
  next_due_at: string | null;
}

// LLM output: checkup that this document could complete
interface CheckupToComplete {
  checkup_item_id: string;
  reason: string;
  suggested_done_at: string;
}

// Stored on medical_records.llm_suggested_checkup_completions (enriched with checkup_title)
interface LlmSuggestedCheckupCompletionStored {
  checkup_item_id: string;
  reason: string;
  suggested_done_at: string;
  checkup_title: string;
}

interface StructuredDataWithObservationsAndFindings extends StructuredData {
  observations: ExtractedObservation[];
  findings: ExtractedFinding[];
  conditions: ExtractedCondition[];
  findings_to_resolve: FindingToResolve[];
  conditions_to_resolve: ConditionToResolve[];
  checkups_to_complete: CheckupToComplete[];
}

// Fetch observation catalog from database
async function fetchObservationCatalog(
  supabase: SupabaseClient<Database>,
): Promise<ObservationCatalogItem[]> {
  const { data, error } = await supabase
    .from("observation_catalog")
    .select(
      "id, obs_code, name_ru, name_en, canonical_unit, synonyms_ru, synonyms_en, accepted_units",
    )
    .order("obs_code");

  if (error) {
    console.error("Error fetching observation catalog:", error);
    return [];
  }

  return (data || []) as ObservationCatalogItem[];
}

// Fetch finding type catalog from database
async function fetchFindingTypeCatalog(
  supabase: SupabaseClient<Database>,
): Promise<FindingTypeCatalogItem[]> {
  const { data, error } = await supabase
    .from("finding_type_catalog")
    .select("id, finding_code, name_ru, name_en, synonyms_ru, synonyms_en")
    .order("finding_code");

  if (error) {
    console.error("Error fetching finding type catalog:", error);
    return [];
  }

  return data || [];
}

// Fetch body site catalog from database
async function fetchBodySiteCatalog(
  supabase: SupabaseClient<Database>,
): Promise<BodySiteCatalogItem[]> {
  const { data, error } = await supabase
    .from("body_site_catalog")
    .select("id, site_code, name_ru, name_en, parent_site_code, synonyms_ru, synonyms_en")
    .order("site_code");

  if (error) {
    console.error("Error fetching body site catalog:", error);
    return [];
  }

  return data || [];
}

// Fetch existing conditions for a person (to provide context to LLM)
async function fetchPersonConditions(
  supabase: SupabaseClient<Database>,
  personId: string,
): Promise<ExistingCondition[]> {
  const { data, error } = await supabase
    .from("conditions")
    .select("id, name, code, current_status, onset_date, resolved_date")
    .eq("person_id", personId)
    .is("deleted_at", null)
    .order("name");

  if (error) {
    console.error("Error fetching person conditions:", error);
    return [];
  }

  return data || [];
}

// Helper to determine if a finding is resolved (size=0 or count=0)
function isResolved(size: number | null, count: number | null): boolean {
  return size === 0 || count === 0;
}

// Fetch existing active findings for a person (aggregated by finding_code + site_code)
// Returns only findings that are NOT resolved (latest entry has size_mm > 0 or count > 0)
async function fetchPersonActiveFindings(
  supabase: SupabaseClient<Database>,
  personId: string,
): Promise<ExistingFinding[]> {
  // Fetch all findings from active records for this person
  const { data, error } = await supabase
    .from("record_findings")
    .select(
      `
      id,
      finding_code,
      finding_type_text,
      site_code,
      body_site_text,
      finding_type_id,
      body_site_id,
      size_mm,
      count,
      severity,
      finding_date,
      created_at,
      medical_records!inner(
        person_id,
        record_date,
        status
      )
    `,
    )
    .eq("medical_records.person_id", personId)
    .eq("medical_records.status", "active")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error fetching person findings:", error);
    return [];
  }

  if (!data || data.length === 0) {
    return [];
  }

  // Group by finding_code + site_code (or finding_type_text + body_site_text for unrecognized)
  const findingMap = new Map<
    string,
    {
      rows: Array<{
        finding_code: string | null;
        finding_type_text: string;
        site_code: string | null;
        body_site_text: string | null;
        finding_type_id: string | null;
        body_site_id: string | null;
        size_mm: number | null;
        count: number | null;
        severity: string;
        finding_date: string | null;
        created_at: string;
        medical_records: { record_date: string | null };
      }>;
    }
  >();

  for (const row of data as unknown[]) {
    const r = row as {
      finding_code: string | null;
      finding_type_text: string;
      site_code: string | null;
      body_site_text: string | null;
      finding_type_id: string | null;
      body_site_id: string | null;
      size_mm: number | null;
      count: number | null;
      severity: string;
      finding_date: string | null;
      created_at: string;
      medical_records: { record_date: string | null };
    };

    // Create a unique key for grouping
    const findingKey = r.finding_code || r.finding_type_text.toLowerCase().trim();
    const siteKey = r.site_code || r.body_site_text?.toLowerCase().trim() || "unknown";
    const key = `${findingKey}::${siteKey}`;

    if (findingMap.has(key)) {
      findingMap.get(key)!.rows.push(r);
    } else {
      findingMap.set(key, { rows: [r] });
    }
  }

  // Convert map to array, find latest values, filter out resolved
  const activeFindings: ExistingFinding[] = [];

  for (const { rows } of findingMap.values()) {
    // Sort by date (newest first)
    rows.sort((a, b) => {
      const dateA = a.finding_date || a.medical_records.record_date || a.created_at;
      const dateB = b.finding_date || b.medical_records.record_date || b.created_at;
      return new Date(dateB).getTime() - new Date(dateA).getTime();
    });

    // Get latest entry
    const latest = rows[0];

    // Skip if the latest entry shows it's resolved
    if (isResolved(latest.size_mm, latest.count)) {
      continue;
    }

    // Find the most recent size/count values (in case latest has nulls)
    const latestWithSize = rows.find((r) => r.size_mm !== null);
    const latestWithCount = rows.find((r) => r.count !== null);

    activeFindings.push({
      finding_code: latest.finding_code,
      finding_type_text: latest.finding_type_text,
      site_code: latest.site_code,
      body_site_text: latest.body_site_text,
      finding_type_id: latest.finding_type_id,
      body_site_id: latest.body_site_id,
      latest_size_mm: latestWithSize?.size_mm ?? null,
      latest_count: latestWithCount?.count ?? null,
      severity: latest.severity,
      latest_date: latest.finding_date || latest.medical_records.record_date,
    });
  }

  return activeFindings;
}

// Fetch upcoming/overdue checkup items for a person (active, with next_due_at)
async function fetchUpcomingOverdueCheckupItems(
  supabase: SupabaseClient<Database>,
  personId: string,
): Promise<CheckupItemForContext[]> {
  const { data, error } = await supabase
    .from("checkup_items")
    .select("id, title, category, next_due_at")
    .eq("person_id", personId)
    .eq("status", "active")
    .not("next_due_at", "is", null)
    .order("next_due_at", { ascending: true });

  if (error) {
    console.error("Error fetching checkup items for person:", error);
    return [];
  }

  return (data || []).map(
    (row: { id: string; title: string; category: string; next_due_at: string | null }) => ({
      id: row.id,
      title: row.title,
      category: row.category,
      next_due_at: row.next_due_at,
    }),
  );
}

async function recomputeConditionCurrentStatus(
  supabaseAdmin: SupabaseClient<Database>,
  conditionId: string,
): Promise<void> {
  const { data: latest } = await supabaseAdmin
    .from("condition_records")
    .select("status_in_record, medical_records!inner(record_date)")
    .eq("condition_id", conditionId)
    .order("medical_records(record_date)", { ascending: false })
    .limit(1)
    .maybeSingle();
  const status = (latest as { status_in_record?: string } | null)?.status_in_record;
  if (status) {
    await supabaseAdmin.from("conditions").update({ current_status: status }).eq("id", conditionId);
  }
}

async function lookupIcdCode(code: string): Promise<IcdLookupResult | null> {
  try {
    const icdRes = await fetch(`${SUPABASE_URL}/functions/v1/icd-lookup`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ code }),
    });

    if (!icdRes.ok) {
      console.error(`ICD lookup failed for ${code}:`, icdRes.status);
      return null;
    }

    return await icdRes.json();
  } catch (error) {
    console.error(`ICD lookup error for ${code}:`, error);
    return null;
  }
}

// Build observation catalog prompt section
function buildObservationCatalogPrompt(catalog: ObservationCatalogItem[]): string {
  if (catalog.length === 0) {
    return "Каталог показателей пуст. Извлекай показатели без привязки к коду.";
  }

  const items = catalog.map((item) => {
    const synonyms = [...new Set([...item.synonyms_ru, ...item.synonyms_en])].join(", ");
    const units = Object.keys(item.accepted_units).join(", ");
    return `- ${item.obs_code}: "${item.name_ru}" / "${item.name_en}" (синонимы: ${synonyms}) [ДОПУСТИМЫЕ ЕДИНИЦЫ: ${units}]`;
  });

  return `КАТАЛОГ ИЗВЕСТНЫХ ПОКАЗАТЕЛЕЙ:
${items.join("\n")}

ВАЖНО ДЛЯ КАТАЛОГА:
- Если показатель соответствует одному из каталога, используй его obs_code
- Если показатель найден в каталоге, единица измерения (unit) ДОЛЖНА быть одной из ДОПУСТИМЫХ ЕДИНИЦ этого показателя
- Каталог указывает допустимые единицы для каждого показателя - используй ТОЛЬКО их для корректной конвертации
- Если показатель не соответствует каталогу - оставь obs_code как null`;
}

// Build finding type catalog prompt section
function buildFindingTypeCatalogPrompt(catalog: FindingTypeCatalogItem[]): string {
  if (catalog.length === 0) {
    return "Каталог типов находок пуст.";
  }

  const items = catalog.map((item) => {
    const synonyms = [...new Set([...item.synonyms_ru, ...item.synonyms_en])].join(", ");
    return `- ${item.finding_code}: "${item.name_ru}" / "${item.name_en}" (синонимы: ${synonyms})`;
  });

  return `КАТАЛОГ ТИПОВ НАХОДОК (finding_code):
${items.join("\n")}`;
}

// Build body site catalog prompt section
function buildBodySiteCatalogPrompt(catalog: BodySiteCatalogItem[]): string {
  if (catalog.length === 0) {
    return "Каталог локализаций пуст.";
  }

  const items = catalog.map((item) => {
    const synonyms = [...new Set([...item.synonyms_ru, ...item.synonyms_en])].join(", ");
    const parent = item.parent_site_code ? ` [родитель: ${item.parent_site_code}]` : "";
    return `- ${item.site_code}: "${item.name_ru}" / "${item.name_en}" (синонимы: ${synonyms})${parent}`;
  });

  return `КАТАЛОГ ЛОКАЛИЗАЦИЙ (site_code):
${items.join("\n")}`;
}

// Build existing conditions context for LLM prompt
function buildExistingConditionsPrompt(conditions: ExistingCondition[]): string {
  if (conditions.length === 0) {
    return "У пациента пока нет зарегистрированных диагнозов.";
  }

  // Separate active conditions for emphasis
  const activeConditions = conditions.filter(
    (c) => c.current_status === "active" || c.current_status === "suspected",
  );
  const otherConditions = conditions.filter(
    (c) => c.current_status !== "active" && c.current_status !== "suspected",
  );

  const formatCondition = (c: ExistingCondition) => {
    const dates = [];
    if (c.onset_date) dates.push(`начало: ${c.onset_date}`);
    if (c.resolved_date) dates.push(`окончание: ${c.resolved_date}`);
    const dateStr = dates.length > 0 ? ` (${dates.join(", ")})` : "";
    const codeStr = c.code ? `код: ${c.code} | ` : "";
    return `- ID: "${c.id}" | ${codeStr}"${c.name}" | статус: ${c.current_status}${dateStr}`;
  };

  let prompt = `СУЩЕСТВУЮЩИЕ ДИАГНОЗЫ ПАЦИЕНТА:`;

  if (activeConditions.length > 0) {
    prompt += `\n\n*** АКТИВНЫЕ ДИАГНОЗЫ (проверь, не нужно ли закрыть на основе этого документа!) ***
${activeConditions.map(formatCondition).join("\n")}`;
  }

  if (otherConditions.length > 0) {
    prompt += `\n\nПрочие диагнозы (resolved/history):
${otherConditions.map(formatCondition).join("\n")}`;
  }

  prompt += `

ВАЖНО: Если документ упоминает один из существующих диагнозов (или его синоним/вариацию):
- Используй existing_condition_id с ID из списка выше
- Если у существующего диагноза есть МКБ-10 код — сопоставляй по нему!
- Укажи НОВЫЙ статус если он изменился (например, "resolved" если вылечено)
- name можно оставить пустым или указать как в документе

ВАЖНО: Проверь АКТИВНЫЕ диагнозы — если документ показывает нормализацию/выздоровление, добавь в conditions_to_resolve!

Если диагноз НОВЫЙ (не найден в списке выше):
- existing_condition_id = null
- name = название диагноза из документа
- icd_code = код МКБ-10 если известен`;

  return prompt;
}

// Build existing active findings context for LLM prompt
function buildExistingFindingsPrompt(findings: ExistingFinding[]): string {
  if (findings.length === 0) {
    return "У пациента пока нет зарегистрированных активных находок.";
  }

  const items = findings.map((f) => {
    const parts = [];
    if (f.finding_code) parts.push(`finding_code: "${f.finding_code}"`);
    if (f.site_code) parts.push(`site_code: "${f.site_code}"`);
    parts.push(`текст: "${f.finding_type_text}"`);
    if (f.body_site_text) parts.push(`локализация: "${f.body_site_text}"`);
    if (f.latest_size_mm !== null) parts.push(`размер: ${f.latest_size_mm}мм`);
    if (f.latest_count !== null && f.latest_count > 1) parts.push(`кол-во: ${f.latest_count}`);
    parts.push(`тяжесть: ${f.severity}`);
    if (f.latest_date) parts.push(`дата: ${f.latest_date}`);
    return `- ${parts.join(" | ")}`;
  });

  return `СУЩЕСТВУЮЩИЕ АКТИВНЫЕ НАХОДКИ ПАЦИЕНТА:
${items.join("\n")}`;
}

// Build upcoming/overdue checkups context for LLM prompt
function buildCheckupsPrompt(checkups: CheckupItemForContext[]): string {
  if (checkups.length === 0) {
    return "У пациента нет предстоящих или просроченных обследований (checkups).";
  }

  const items = checkups.map((c) => {
    const due = c.next_due_at ? ` next_due_at: ${c.next_due_at}` : "";
    return `- id: "${c.id}" | title: "${c.title}" | category: ${c.category}${due}`;
  });

  return `ПРЕДСТОЯЩИЕ ИЛИ ПРОСРОЧЕННЫЕ ОБСЛЕДОВАНИЯ (checkups) ПАЦИЕНТА:
${items.join("\n")}

Определи, какие из этих обследований этот документ мог бы ЗАКРЫТЬ (выполнить). Например: анализ крови — закрывает "Общий анализ крови"; результат УЗИ — закрывает "УЗИ брюшной полости".`;
}

// Call LLM to extract structured data from OCR text
async function extractStructuredData(
  ocrText: string,
  observationCatalog: ObservationCatalogItem[],
  findingTypeCatalog: FindingTypeCatalogItem[],
  bodySiteCatalog: BodySiteCatalogItem[],
  existingConditions: ExistingCondition[],
  existingFindings: ExistingFinding[],
  checkupItems: CheckupItemForContext[],
): Promise<StructuredDataWithObservationsAndFindings> {
  if (!ocrText || ocrText.trim().length === 0) {
    return {
      record_type: "other",
      title: "Пустой документ",
      record_date: null,
      summary: "Текст не найден",
      keywords: [],
      observations: [],
      findings: [],
      conditions: [],
      findings_to_resolve: [],
      conditions_to_resolve: [],
      checkups_to_complete: [],
    };
  }

  const observationCatalogPrompt = buildObservationCatalogPrompt(observationCatalog);
  const findingTypeCatalogPrompt = buildFindingTypeCatalogPrompt(findingTypeCatalog);
  const bodySiteCatalogPrompt = buildBodySiteCatalogPrompt(bodySiteCatalog);
  const existingConditionsPrompt = buildExistingConditionsPrompt(existingConditions);
  const existingFindingsPrompt = buildExistingFindingsPrompt(existingFindings);
  const checkupsPrompt = buildCheckupsPrompt(checkupItems);

  const systemPrompt = `Ты — анализатор медицинских документов. Тебе будет дан текст, извлечённый из медицинского документа (OCR).

Твоя задача: проанализировать текст и извлечь структурированную информацию.

Ответь JSON-объектом с полями:
- record_type: одно из "lab", "visit", "imaging", "prescription", "vaccination", "vet", "procedure", "other"
- title: короткое описательное название записи НА РУССКОМ ЯЗЫКЕ (максимум 100 символов)
- record_date: дата документа в формате YYYY-MM-DD, или null если не найдена
- summary: ОЧЕНЬ КРАТКОЕ и ПОЛЕЗНОЕ описание результата НА РУССКОМ ЯЗЫКЕ (1-2 коротких предложения, максимум 150 символов)
- keywords: массив из 3-7 релевантных ключевых слов/тегов НА РУССКОМ ЯЗЫКЕ
- observations: массив извлечённых показателей/результатов анализов
- findings: массив извлечённых находок (полипы, камни, кисты, образования и т.д.)
- conditions: массив извлечённых диагнозов/заболеваний
- findings_to_resolve: массив существующих находок, которые нужно закрыть (если документ указывает на их отсутствие)
- conditions_to_resolve: массив существующих диагнозов, которые нужно закрыть (если документ указывает на выздоровление)
- checkups_to_complete: массив предстоящих/просроченных обследований (checkups), которые этот документ мог бы ЗАКРЫТЬ (подтвердить выполнение)

ВАЖНЫЕ ПРАВИЛА ДЛЯ ТИПА (record_type):
- Если документ упоминает животных или ветеринарную помощь: "vet"
- Для анализов крови, мочи и т.д.: "lab"
- Для рентгена, МРТ, КТ, УЗИ: "imaging"
- Для рецептов или назначений лекарств: "prescription"
- Для записей о вакцинации: "vaccination"
- Для консультаций врача или записей о приёме: "visit"
- Для операций, хирургических вмешательств, процедур (операция, процедура, манипуляция): "procedure"
- Если не подходит ни под одну категорию: "other"

ВАЖНЫЕ ПРАВИЛА ДЛЯ ОПИСАНИЯ (summary):
- Пиши КРАТКО и ПО ДЕЛУ, без воды
- Фокусируйся на РЕЗУЛЬТАТЕ и ВЫВОДАХ, а не на описании процесса
- НЕ пиши "Документ представляет собой..." или "Врач провёл осмотр..."
- Пиши что ВАЖНО для пациента знать
- Примеры хороших описаний:
  * "Обследование перед операцией. Противопоказаний нет."
  * "Гемоглобин 145, всё в норме"
  * "УЗИ печени: без патологий"
  * "Назначен курс антибиотиков на 7 дней"

ВАЖНЫЕ ПРАВИЛА ДЛЯ ЗАГОЛОВКА (title):
- НЕ включай имена пациентов, врачей или клиник
- НЕ включай даты
- Заголовок должен описывать ТИП и СОДЕРЖАНИЕ исследования/документа
- Используй СТАНДАРТНЫЕ медицинские названия
- Примеры хороших заголовков: "Общий анализ крови", "УЗИ брюшной полости", "Консультация терапевта"

ВАЖНЫЕ ПРАВИЛА ДЛЯ КЛЮЧЕВЫХ СЛОВ (keywords):
- Используй СТАНДАРТНЫЕ русские медицинские термины
- Нормализуй сокращения: ОАК → общий анализ крови, УЗИ → ультразвуковое исследование
- Добавляй ключевые слова по органам/системам: печень, почки, сердце, кровь и т.д.
- НЕ добавляй названия показателей анализов (гемоглобин, ферритин, глюкоза и т.д.) как ключевые слова - они извлекаются отдельно в observations

${observationCatalogPrompt}

ПРАВИЛА ДЛЯ ИЗВЛЕЧЕНИЯ ПОКАЗАТЕЛЕЙ (observations):
Каждый показатель — это объект с полями:
- obs_code: код из каталога если есть соответствие, или null
- obs_name: название показателя как в документе (на русском)
- value: значение как строка (как написано в документе)
- value_numeric: числовое значение если можно распарсить, иначе null
- unit: единица измерения из документа (ВАЖНО: если показатель найден в каталоге, используй ТОЛЬКО допустимые единицы из каталога)
- ref_range: референсный интервал как строка если указан (например "12.0-16.0" или интервал может быть в виде списка границ с пометками)
- ref_range_low: нижняя граница нормы как число (например 12.0), или null если не указана
- ref_range_high: верхняя граница нормы как число (например 16.0), или null если не указана
- status: "normal" | "low" | "high" | "critical_low" | "critical_high" | "unknown" | null
  - Определи статус по указанным в документе нормам или пометкам
  - Если есть стрелки ↑↓, пометки "выше нормы", "ниже нормы", "дефицит", "избыток" или схожие синонимы - используй их
  - Если значение в пределах ref_range - "normal"
  - Если значение меньше ref_range_low - "low"
  - Если значение больше ref_range_high - "high"
  - Если не можешь определить - "unknown" или null
- confidence: уверенность в извлечении от 0 до 1 (например 0.9 если точно уверен)

ВАЖНО для observations:
- Извлекай ВСЕ числовые показатели из документа (анализы, измерения)
- Не извлекай текстовые описания как показатели (только если есть значение)
- Для качественных результатов (положительный/отрицательный) - value_numeric = null
- Если документ НЕ содержит анализов/показателей - оставь observations пустым массивом []
- ОБЯЗАТЕЛЬНО извлекай ref_range_low и ref_range_high как отдельные числа, если в документе указан референсный интервал

${findingTypeCatalogPrompt}

${bodySiteCatalogPrompt}

ПРАВИЛА ДЛЯ ИЗВЛЕЧЕНИЯ НАХОДОК (findings):
Каждая находка — это объект с полями:
- finding_code: КОД из КАТАЛОГА ТИПОВ НАХОДОК (ОБЯЗАТЕЛЬНО если есть совпадение!), или null
- finding_type_text: название находки как в документе (на русском) - ОБЯЗАТЕЛЬНО
- site_code: КОД из КАТАЛОГА ЛОКАЛИЗАЦИЙ (ОБЯЗАТЕЛЬНО если есть совпадение!), или null
- body_site_text: локализация как в документе (на русском)
- size_mm: размер в мм если указан, или null
- count: количество если указано, или null (по умолчанию 1)
- severity: "mild" | "moderate" | "severe" | "unknown" - степень выраженности
- laterality: "left" | "right" | "bilateral" | "none" - сторона поражения
- morphology: морфологическое описание (форма, структура) если есть
- description: дополнительное описание если есть
- histology: гистологическое заключение если есть
- finding_date: дата обнаружения в формате YYYY-MM-DD если отличается от даты документа
- source_anchor: ТОЧНАЯ ЦИТАТА из документа где описана находка - ОБЯЗАТЕЛЬНО
- confidence: уверенность в извлечении от 0 до 1

КРИТИЧЕСКИ ВАЖНО для findings:
- ОБЯЗАТЕЛЬНО сопоставляй тип находки с finding_code из каталога!
- ОБЯЗАТЕЛЬНО сопоставляй локализацию с site_code из каталога!
- Используй синонимы из каталогов для поиска соответствия
- Если точного совпадения в каталоге нет - оставь код как null, но заполни _text поле
- Для laterality: используй "left"/"right" если указана сторона, "bilateral" если обе стороны, "none" если сторона не применима
- source_anchor должен содержать ТОЧНУЮ цитату из документа (1-2 предложения)

КОГДА извлекать findings:
- Из УЗИ, КТ, МРТ, рентгена - образования, кисты, камни, узлы
- Из эндоскопии (колоноскопия, гастроскопия) - полипы, эрозии, язвы
- Из гистологии - результаты биопсии
- Из любых заключений с патологическими находками

КОГДА НЕ извлекать findings:
- Нормальные заключения без патологии
- Отрицательные находки ("камней не выявлено", "без особенностей")
- Из лабораторных анализов - они идут в observations

${existingConditionsPrompt}

ПРАВИЛА ДЛЯ ИЗВЛЕЧЕНИЯ ДИАГНОЗОВ (conditions):
Каждый диагноз — это объект с полями:
- existing_condition_id: ID существующего диагноза из списка выше, или null если новый
- name: название диагноза КАК В ДОКУМЕНТЕ (ОБЯЗАТЕЛЬНО если новый)
- icd_code: код МКБ-10 если можно определить (например "D50.9", "E11.9", "J06.9"), или null
- status: текущий статус диагноза В ЭТОМ ДОКУМЕНТЕ
  - "active" — подтверждённый текущий диагноз
  - "suspected" — подозреваемый, требует подтверждения
  - "resolved" — вылечено, в ремиссии
  - "history" — перенесённое заболевание в анамнезе
- confidence: уверенность в извлечении от 0 до 1
- source_anchor: ТОЧНАЯ ЦИТАТА из документа где указан диагноз

ВАЖНО ДЛЯ МКБ-10 КОДОВ:
- Используй icd_code для сопоставления с существующими диагнозами!
- Если у существующего диагноза есть код "D50.9" и в документе упоминается "анемия" с тем же кодом — это ТОТ ЖЕ диагноз
- Распространённые коды: D50.9 (ЖДА), E11.9 (СД 2 типа), I10 (гипертония), K21 (ГЭРБ), J06.9 (ОРВИ)

ПРИМЕРЫ СОПОСТАВЛЕНИЯ:
- Документ: "Анемия купирована" + существует "Железодефицитная анемия (active)"
  → existing_condition_id = "uuid...", status = "resolved"
  
- Документ: "Диагноз: Сахарный диабет 2 типа" + НЕТ в списке
  → existing_condition_id = null, name = "Сахарный диабет 2 типа", status = "active"

- Документ: "В анамнезе: ветряная оспа" + существует "Ветряная оспа (history)"
  → existing_condition_id = "uuid...", status = "history" (статус не изменился)

КОГДА извлекать conditions:
- Явные диагнозы: "Диагноз: Железодефицитная анемия"
- Заключения: "Заключение: ГЭРБ, хронический гастрит"
- Анамнез: "Перенесённые заболевания: ветряная оспа, COVID-19"
- Подозрения: "Подозрение на диабет 2 типа"
- Упоминания об изменении статуса: "анемия вылечена", "диабет компенсирован"

КОГДА НЕ извлекать conditions:
- Симптомы без диагноза (головная боль, тошнота)
- Находки из imaging/эндоскопии — они идут в findings
- Показатели анализов — они идут в observations

${existingFindingsPrompt}

ПРАВИЛА ДЛЯ РАЗРЕШЕНИЯ НАХОДОК (findings_to_resolve):
Если документ ЯВНО указывает, что ранее зафиксированная находка больше НЕ обнаружена:
- "полипов не обнаружено" при наличии записи о полипе в соответствующей локализации
- "камни удалены успешно" или "камней не выявлено"
- "киста не визуализируется"
- "Дополнительные образования: не выявлены" при наличии записи об образовании в этом органе
- "Эхопатологии не выявлено" при наличии записи о патологии в этом органе
- "Без особенностей" при осмотре области с известной находкой
→ Добавь в findings_to_resolve с ТОЧНОЙ цитатой из документа

Каждый элемент findings_to_resolve:
- finding_code: код находки из существующего списка (или null)
- finding_type_text: текст находки
- site_code: код локализации из существующего списка (или null)
- body_site_text: текст локализации
- reason: причина закрытия (кратко)
- source_anchor: ТОЧНАЯ ЦИТАТА из документа, подтверждающая отсутствие
- confidence: уверенность от 0 до 1

НЕ закрывай находку если:
- Область НЕ исследовалась в этом документе
- Нет ЯВНОГО указания об отсутствии находки
- Документ относится к другому органу/локализации

ПРАВИЛА ДЛЯ РАЗРЕШЕНИЯ ДИАГНОЗОВ (conditions_to_resolve):
ВАЖНО: Если у пациента есть активный диагноз и документ показывает, что он больше НЕ актуален — добавь в conditions_to_resolve!

КОГДА добавлять в conditions_to_resolve:
- Явное указание на выздоровление: "Анемия купирована", "Полное выздоровление", "Заболевание вылечено"
- Лабораторные показатели нормализовались: если была "Железодефицитная анемия" и гемоглобин/ферритин в норме
- Связанная находка закрыта: если была "Полипоз толстой кишки" и полипы не обнаружены при обследовании
- Диагноз в ремиссии: "Диабет компенсирован", "Гипертония контролируемая"
- Отрицательные результаты обследования: "Патологии не выявлено" при обследовании органа с известным диагнозом

ПРИМЕРЫ:
- Существует "Железодефицитная анемия (active)" + документ показывает гемоглобин 140 г/л (норма)
  → Добавь в conditions_to_resolve: condition_id="uuid", reason="Гемоглобин в норме"

- Существует "Полипоз толстой кишки (active)" + колоноскопия "Полипов не обнаружено"
  → Добавь в conditions_to_resolve: condition_id="uuid", reason="Полипы не обнаружены при колоноскопии"

- Существует "Мочекаменная болезнь (active)" + УЗИ "Конкременты не визуализируются"
  → Добавь в conditions_to_resolve: condition_id="uuid", reason="Камни не обнаружены на УЗИ"

ВАЖНО: Используй conditions_to_resolve ТОЛЬКО для диагнозов из списка СУЩЕСТВУЮЩИЕ ДИАГНОЗЫ ПАЦИЕНТА!
Проверь список существующих диагнозов и сопоставь с результатами документа!

Каждый элемент conditions_to_resolve:
- condition_id: ID диагноза из списка существующих (ОБЯЗАТЕЛЬНО! Копируй точный UUID из списка)
- reason: причина закрытия (кратко, на русском)
- source_anchor: ТОЧНАЯ ЦИТАТА из документа, подтверждающая выздоровление/нормализацию
- confidence: уверенность от 0 до 1

НЕ закрывай диагноз если:
- Нет связи между документом и диагнозом (документ об одном, диагноз о другом)
- Документ НЕ исследует область/систему, связанную с диагнозом
- Показатели немного улучшились, но ещё не в норме

${checkupsPrompt}

ПРАВИЛА ДЛЯ checkups_to_complete:
Если у пациента есть предстоящие/просроченные обследования (список выше), определи, какие из них этот документ мог бы ЗАКРЫТЬ (подтвердить выполнение).
Примеры: результат ОАК — закрывает checkup "Общий анализ крови"; результат УЗИ печени — закрывает "УЗИ брюшной полости"; запись о прививке — закрывает "Вакцинация".
Каждый элемент checkups_to_complete:
- checkup_item_id: ID из списка ПРЕДСТОЯЩИЕ/ПРОСРОЧЕННЫЕ ОБСЛЕДОВАНИЯ (ОБЯЗАТЕЛЬНО, точный UUID)
- reason: краткая причина на русском (что в документе подтверждает выполнение)
- suggested_done_at: дата выполнения в формате YYYY-MM-DD (дата документа или record_date)
Добавляй только те checkups, которые документ ОДНОЗНАЧНО подтверждает. Если сомневаешься — не добавляй.`;

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": SUPABASE_URL || "http://localhost:3000",
    },
    body: JSON.stringify({
      model: "openai/gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Проанализируй этот текст медицинского документа:\n\n${ocrText}` },
      ],
      temperature: 0.3,
      max_tokens: 18000, // Increased for observations + findings
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenRouter API error: ${error}`);
  }

  const data = await response.json();
  const responseContent = data.choices[0]?.message?.content;

  if (!responseContent) {
    throw new Error("No response from OpenRouter");
  }

  try {
    const parsed = JSON.parse(responseContent);
    const rawRecordType = parsed.record_type || "other";
    const record_type =
      typeof rawRecordType === "string" &&
      (ALLOWED_RECORD_TYPES as readonly string[]).includes(rawRecordType)
        ? rawRecordType
        : "other";
    return {
      record_type,
      title: parsed.title || "Медицинский документ",
      record_date: parsed.record_date || null,
      summary: parsed.summary || "",
      keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
      observations: Array.isArray(parsed.observations)
        ? parsed.observations.map((obs: Partial<ExtractedObservation>) => ({
            obs_code: obs.obs_code || null,
            obs_name: obs.obs_name || "Неизвестный показатель",
            value: obs.value || "",
            value_numeric: typeof obs.value_numeric === "number" ? obs.value_numeric : null,
            unit: obs.unit || null,
            ref_range: obs.ref_range || null,
            ref_range_low: typeof obs.ref_range_low === "number" ? obs.ref_range_low : null,
            ref_range_high: typeof obs.ref_range_high === "number" ? obs.ref_range_high : null,
            status: obs.status || null,
            confidence: typeof obs.confidence === "number" ? obs.confidence : 0.8,
          }))
        : [],
      findings: Array.isArray(parsed.findings)
        ? parsed.findings.map((f: Partial<ExtractedFinding>) => ({
            finding_code: f.finding_code || null,
            finding_type_text: f.finding_type_text || "Неизвестная находка",
            site_code: f.site_code || null,
            body_site_text: f.body_site_text || null,
            size_mm: typeof f.size_mm === "number" ? f.size_mm : null,
            count: typeof f.count === "number" ? f.count : null,
            severity:
              f.severity === "mild" || f.severity === "moderate" || f.severity === "severe"
                ? f.severity
                : "unknown",
            laterality:
              f.laterality === "left" || f.laterality === "right" || f.laterality === "bilateral"
                ? f.laterality
                : "none",
            morphology: f.morphology || null,
            description: f.description || null,
            histology: f.histology || null,
            finding_date: f.finding_date || null,
            source_anchor: f.source_anchor || "",
            confidence: typeof f.confidence === "number" ? f.confidence : 0.8,
          }))
        : [],
      conditions: Array.isArray(parsed.conditions)
        ? parsed.conditions.map((c: Partial<ExtractedCondition>) => ({
            existing_condition_id: c.existing_condition_id || null,
            name: c.name || "",
            icd_code: c.icd_code || null,
            status:
              c.status === "active" ||
              c.status === "resolved" ||
              c.status === "suspected" ||
              c.status === "history"
                ? c.status
                : "suspected",
            confidence: typeof c.confidence === "number" ? c.confidence : 0.8,
            source_anchor: c.source_anchor || null,
          }))
        : [],
      findings_to_resolve: Array.isArray(parsed.findings_to_resolve)
        ? parsed.findings_to_resolve.map((f: Partial<FindingToResolve>) => ({
            finding_code: f.finding_code || null,
            finding_type_text: f.finding_type_text || "",
            site_code: f.site_code || null,
            body_site_text: f.body_site_text || null,
            reason: f.reason || "",
            source_anchor: f.source_anchor || "",
            confidence: typeof f.confidence === "number" ? f.confidence : 0.8,
          }))
        : [],
      conditions_to_resolve: Array.isArray(parsed.conditions_to_resolve)
        ? parsed.conditions_to_resolve.map((c: Partial<ConditionToResolve>) => ({
            condition_id: c.condition_id || "",
            reason: c.reason || "",
            source_anchor: c.source_anchor || "",
            confidence: typeof c.confidence === "number" ? c.confidence : 0.8,
          }))
        : [],
      checkups_to_complete: Array.isArray(parsed.checkups_to_complete)
        ? parsed.checkups_to_complete.map((c: Partial<CheckupToComplete>) => ({
            checkup_item_id: c.checkup_item_id || "",
            reason: c.reason || "",
            suggested_done_at:
              typeof c.suggested_done_at === "string" && c.suggested_done_at.trim().length > 0
                ? c.suggested_done_at.trim().slice(0, 10)
                : parsed.record_date || new Date().toISOString().slice(0, 10),
          }))
        : [],
    };
  } catch {
    throw new Error("Failed to parse OpenRouter response as JSON");
  }
}

// Find catalog entry by obs_code
function findCatalogEntry(
  obsCode: string | null,
  catalog: ObservationCatalogItem[],
): ObservationCatalogItem | null {
  if (!obsCode) return null;
  return catalog.find((c) => c.obs_code === obsCode) || null;
}

// Find finding type catalog entry by finding_code
function findFindingTypeCatalogEntry(
  findingCode: string | null,
  catalog: FindingTypeCatalogItem[],
): FindingTypeCatalogItem | null {
  if (!findingCode) return null;
  return catalog.find((c) => c.finding_code === findingCode) || null;
}

// Find body site catalog entry by site_code
function findBodySiteCatalogEntry(
  siteCode: string | null,
  catalog: BodySiteCatalogItem[],
): BodySiteCatalogItem | null {
  if (!siteCode) return null;
  return catalog.find((c) => c.site_code === siteCode) || null;
}

// Evaluate a simple formula string for unit conversion
// Supports formulas like "percent = (mmol_per_mol * 0.09148) + 2.152"
function evaluateFormula(formula: string, inputValue: number): number | null {
  try {
    // Extract the expression part (after the "=")
    const parts = formula.split("=");
    if (parts.length !== 2) return null;

    let expression = parts[1].trim();

    // Replace common variable names with the input value
    // Common patterns: mmol_per_mol, value, x, input, etc.
    expression = expression.replace(/mmol_per_mol|value|input|x/gi, inputValue.toString());

    // Simple safe evaluation using Function constructor
    // Only allows numbers, operators, and parentheses
    if (!/^[\d\s+\-*/().]+$/.test(expression)) {
      console.warn(`Unsafe formula expression: ${expression}`);
      return null;
    }

    // Evaluate the expression
    const result = new Function(`return ${expression}`)();
    return typeof result === "number" && !isNaN(result) ? result : null;
  } catch (e) {
    console.error(`Error evaluating formula "${formula}":`, e);
    return null;
  }
}

// Get unit config from catalog entry (case-insensitive matching)
function getUnitConfig(
  unit: string | null,
  catalogEntry: ObservationCatalogItem | null,
): { factor_to_canonical?: number; formula_to_canonical?: string } | null {
  if (!catalogEntry || !unit) return null;

  // Try case-sensitive first
  let unitConfig = catalogEntry.accepted_units[unit];

  if (!unitConfig) {
    // Try case-insensitive match
    const unitLower = unit.toLowerCase();
    for (const [u, config] of Object.entries(catalogEntry.accepted_units)) {
      if (u.toLowerCase() === unitLower) {
        unitConfig = config;
        break;
      }
    }
  }

  return unitConfig || null;
}

// Convert a single value using unit config
function convertValueWithConfig(
  value: number | null,
  unitConfig: { factor_to_canonical?: number; formula_to_canonical?: string } | null,
): number | null {
  if (value === null || !unitConfig) return null;

  // Try factor-based conversion first
  if (unitConfig.factor_to_canonical !== undefined) {
    return value * unitConfig.factor_to_canonical;
  }

  // Try formula-based conversion
  if (unitConfig.formula_to_canonical) {
    return evaluateFormula(unitConfig.formula_to_canonical, value);
  }

  return null;
}

// Convert value to canonical unit
function convertToCanonical(
  value: number | null,
  unit: string | null,
  catalogEntry: ObservationCatalogItem | null,
): { value_canonical: number | null; unit_canonical: string | null } {
  if (!catalogEntry || value === null || !unit) {
    return { value_canonical: null, unit_canonical: null };
  }

  const unitConfig = getUnitConfig(unit, catalogEntry);
  if (!unitConfig) {
    return { value_canonical: null, unit_canonical: null };
  }

  const converted = convertValueWithConfig(value, unitConfig);
  if (converted !== null) {
    return {
      value_canonical: converted,
      unit_canonical: catalogEntry.canonical_unit,
    };
  }

  return { value_canonical: null, unit_canonical: null };
}

// Convert ref range values to canonical units
function convertRefRangeToCanonical(
  refLow: number | null,
  refHigh: number | null,
  unit: string | null,
  catalogEntry: ObservationCatalogItem | null,
): { ref_range_low_canonical: number | null; ref_range_high_canonical: number | null } {
  if (!catalogEntry || !unit) {
    return { ref_range_low_canonical: null, ref_range_high_canonical: null };
  }

  const unitConfig = getUnitConfig(unit, catalogEntry);
  if (!unitConfig) {
    return { ref_range_low_canonical: null, ref_range_high_canonical: null };
  }

  return {
    ref_range_low_canonical: convertValueWithConfig(refLow, unitConfig),
    ref_range_high_canonical: convertValueWithConfig(refHigh, unitConfig),
  };
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Validate environment
    if (!OPENROUTER_API_KEY) {
      throw new Error("OPENROUTER_API_KEY not configured");
    }
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Supabase environment not configured");
    }

    // Get auth header
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("Missing authorization header");
    }

    const token = authHeader.replace("Bearer ", "");

    // Create Supabase client with anon key and user's token for RLS
    const supabaseClient = createClient<Database>(
      SUPABASE_URL,
      SUPABASE_ANON_KEY || SUPABASE_SERVICE_ROLE_KEY,
      {
        global: {
          headers: { Authorization: `Bearer ${token}` },
        },
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      },
    );

    // Verify user is authenticated by getting user info
    const {
      data: { user },
      error: authError,
    } = await supabaseClient.auth.getUser(token);

    if (authError || !user) {
      console.error("Auth error:", authError);
      throw new Error("Unauthorized - invalid token");
    }

    // Check allowlist using service role (bypasses RLS)
    const supabaseAdmin = createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const { data: allowedUser, error: allowlistError } = await supabaseAdmin
      .from("allowed_users")
      .select("id")
      .or(`auth_user_id.eq.${user.id},email.eq.${user.email}`)
      .single();

    if (allowlistError || !allowedUser) {
      throw new Error("User not in allowlist");
    }

    // Parse request body
    const body: StructureRequest = await req.json();
    const { record_id } = body;

    if (!record_id) {
      throw new Error("Missing required field: record_id");
    }

    // Get record with OCR text
    const { data: record, error: recordError } = await supabaseAdmin
      .from("medical_records")
      .select("id, person_id, ocr_text, status")
      .eq("id", record_id)
      .single();

    if (recordError || !record) {
      throw new Error("Record not found or access denied");
    }

    if (!record.ocr_text) {
      throw new Error("No OCR text found for this record. Run health-ocr first.");
    }

    // Fetch all catalogs, existing conditions, existing findings, and checkup items for LLM context
    const [
      observationCatalog,
      findingTypeCatalog,
      bodySiteCatalog,
      existingConditions,
      existingFindings,
      checkupItems,
    ] = await Promise.all([
      fetchObservationCatalog(supabaseAdmin),
      fetchFindingTypeCatalog(supabaseAdmin),
      fetchBodySiteCatalog(supabaseAdmin),
      fetchPersonConditions(supabaseAdmin, record.person_id),
      fetchPersonActiveFindings(supabaseAdmin, record.person_id),
      fetchUpcomingOverdueCheckupItems(supabaseAdmin, record.person_id),
    ]);
    console.log(`Loaded ${observationCatalog.length} observation catalog entries`);
    console.log(`Loaded ${findingTypeCatalog.length} finding type catalog entries`);
    console.log(`Loaded ${bodySiteCatalog.length} body site catalog entries`);
    console.log(`Loaded ${existingConditions.length} existing conditions for person`);
    console.log(`Loaded ${existingFindings.length} existing active findings for person`);
    console.log(`Loaded ${checkupItems.length} upcoming/overdue checkup items for person`);

    // Extract structured data from OCR text
    const structuredData = await extractStructuredData(
      record.ocr_text,
      observationCatalog,
      findingTypeCatalog,
      bodySiteCatalog,
      existingConditions,
      existingFindings,
      checkupItems,
    );
    console.log(`Extracted ${structuredData.observations.length} observations`);
    console.log(`Extracted ${structuredData.findings.length} findings`);
    console.log(`Extracted ${structuredData.conditions.length} conditions`);
    console.log(`Findings to resolve: ${structuredData.findings_to_resolve.length}`);
    console.log(`Conditions to resolve: ${structuredData.conditions_to_resolve.length}`);
    console.log(`Checkups to complete: ${structuredData.checkups_to_complete.length}`);

    // Enrich checkups_to_complete with checkup_title for storage
    const llmSuggestedCheckupCompletions: LlmSuggestedCheckupCompletionStored[] | null =
      structuredData.checkups_to_complete.length > 0
        ? structuredData.checkups_to_complete
            .filter((c) => c.checkup_item_id && c.checkup_item_id.trim().length > 0)
            .map((c) => {
              const item = checkupItems.find((ci) => ci.id === c.checkup_item_id);
              return {
                checkup_item_id: c.checkup_item_id,
                reason: c.reason || "",
                suggested_done_at: c.suggested_done_at,
                checkup_title: item?.title || "Обследование",
              };
            })
        : null;
    console.log("Extracted observations:", JSON.stringify(structuredData.observations, null, 2));
    console.log("Extracted findings:", JSON.stringify(structuredData.findings, null, 2));
    console.log("Extracted conditions:", JSON.stringify(structuredData.conditions, null, 2));
    console.log(
      "Findings to resolve:",
      JSON.stringify(structuredData.findings_to_resolve, null, 2),
    );
    console.log(
      "Conditions to resolve:",
      JSON.stringify(structuredData.conditions_to_resolve, null, 2),
    );

    // Update the medical record with structured data (including LLM-suggested checkup completions)
    type RecordType = Database["public"]["Tables"]["medical_records"]["Row"]["record_type"];
    const { error: updateError } = await supabaseAdmin
      .from("medical_records")
      .update({
        title: structuredData.title,
        record_type: structuredData.record_type as RecordType,
        record_date: structuredData.record_date,
        notes: structuredData.summary,
        llm_summary: structuredData.summary,
        llm_keywords: structuredData.keywords,
        llm_suggested_checkup_completions: llmSuggestedCheckupCompletions as unknown as Json,
        status: "structure_review", // Ready for user to review structured data
      })
      .eq("id", record_id);

    if (updateError) {
      throw new Error(`Failed to update record: ${updateError.message}`);
    }

    // Delete existing observations for this record (in case of re-extraction)
    await supabaseAdmin.from("record_observations").delete().eq("record_id", record_id);

    // Insert extracted observations
    if (structuredData.observations.length > 0) {
      const observationsToInsert = structuredData.observations.map((obs) => {
        const catalogEntry = findCatalogEntry(obs.obs_code, observationCatalog);
        const { value_canonical, unit_canonical } = convertToCanonical(
          obs.value_numeric,
          obs.unit,
          catalogEntry,
        );
        const { ref_range_low_canonical, ref_range_high_canonical } = convertRefRangeToCanonical(
          obs.ref_range_low,
          obs.ref_range_high,
          obs.unit,
          catalogEntry,
        );

        return {
          record_id,
          catalog_id: catalogEntry?.id || null,
          obs_code: obs.obs_code,
          obs_name: obs.obs_name,
          value_numeric: obs.value_numeric,
          value_text: obs.value,
          unit: obs.unit,
          value_canonical,
          unit_canonical,
          ref_range_text: obs.ref_range,
          ref_range_low: obs.ref_range_low,
          ref_range_high: obs.ref_range_high,
          ref_range_low_canonical,
          ref_range_high_canonical,
          status: obs.status,
          is_llm_extracted: true,
          is_user_verified: false,
          is_applied: obs.obs_code !== null, // Catalog observations are applied by default, custom require user action
          confidence: obs.confidence,
        };
      });

      const { error: obsInsertError } = await supabaseAdmin
        .from("record_observations")
        .insert(observationsToInsert);

      if (obsInsertError) {
        console.error("Error inserting observations:", obsInsertError);
        // Don't fail the whole request, just log the error
      }
    }

    // Delete existing findings for this record (in case of re-extraction)
    await supabaseAdmin.from("record_findings").delete().eq("record_id", record_id);

    // Insert extracted findings
    if (structuredData.findings.length > 0) {
      const findingsToInsert = structuredData.findings
        .filter((f) => f.source_anchor && f.source_anchor.trim().length > 0) // source_anchor is required
        .map((f) => {
          const findingTypeEntry = findFindingTypeCatalogEntry(f.finding_code, findingTypeCatalog);
          const bodySiteEntry = findBodySiteCatalogEntry(f.site_code, bodySiteCatalog);

          return {
            person_id: record.person_id,
            record_id,
            finding_type_id: findingTypeEntry?.id || null,
            finding_code: f.finding_code,
            finding_type_text: f.finding_type_text,
            body_site_id: bodySiteEntry?.id || null,
            site_code: f.site_code,
            body_site_text: f.body_site_text,
            size_mm: f.size_mm,
            count: f.count || 1,
            severity: f.severity,
            laterality: f.laterality,
            morphology: f.morphology,
            description: f.description,
            histology: f.histology,
            finding_date: f.finding_date || structuredData.record_date || null,
            source_anchor: f.source_anchor,
            is_llm_extracted: true,
            is_user_verified: false,
            confidence: f.confidence,
          };
        });

      if (findingsToInsert.length > 0) {
        const { error: findingsInsertError } = await supabaseAdmin
          .from("record_findings")
          .insert(findingsToInsert);

        if (findingsInsertError) {
          console.error("Error inserting findings:", findingsInsertError);
          // Don't fail the whole request, just log the error
        }
      }
    }

    // Delete existing condition_records for this record (in case of re-extraction)
    await supabaseAdmin.from("condition_records").delete().eq("record_id", record_id);

    // Process extracted conditions
    if (structuredData.conditions.length > 0) {
      for (const extracted of structuredData.conditions) {
        let conditionId: string;
        let icdLookupResult: IcdLookupResult | null = null;

        // If there's an ICD code, validate it first
        if (extracted.icd_code) {
          icdLookupResult = await lookupIcdCode(extracted.icd_code);
          console.log(`ICD lookup for ${extracted.icd_code}:`, icdLookupResult);
        }

        if (extracted.existing_condition_id) {
          // LLM matched to existing condition
          conditionId = extracted.existing_condition_id;

          // Update ICD info if we have new validated data
          if (icdLookupResult?.found && extracted.icd_code) {
            await supabaseAdmin
              .from("conditions")
              .update({
                code: extracted.icd_code,
                icd_name_en: icdLookupResult.name_en,
                icd_name_ru: icdLookupResult.name_ru,
              })
              .eq("id", conditionId);
          }
        } else if (extracted.icd_code && icdLookupResult?.found) {
          // New condition with valid ICD code - check for duplicates by ICD code first
          const { data: byCode } = await supabaseAdmin
            .from("conditions")
            .select("id")
            .eq("person_id", record.person_id)
            .eq("code", extracted.icd_code)
            .is("deleted_at", null)
            .maybeSingle();

          if (byCode) {
            // Found existing condition with same ICD code
            conditionId = byCode.id;
            console.log(
              `Found existing condition by ICD code ${extracted.icd_code}: ${conditionId}`,
            );
          } else {
            // Create new condition with ICD info
            const { data: newCondition, error: conditionError } = await supabaseAdmin
              .from("conditions")
              .insert({
                person_id: record.person_id,
                name: extracted.name,
                code: extracted.icd_code,
                icd_name_en: icdLookupResult.name_en,
                icd_name_ru: icdLookupResult.name_ru,
                current_status: extracted.status,
              })
              .select("id")
              .single();

            if (conditionError || !newCondition) {
              console.error("Error creating condition with ICD:", conditionError);
              continue;
            }
            conditionId = newCondition.id;
            console.log(
              `Created new condition with ICD code ${extracted.icd_code}: ${conditionId}`,
            );
          }
        } else if (extracted.name) {
          // New condition without valid ICD code - check for duplicates by name (fallback)
          const { data: existing } = await supabaseAdmin
            .from("conditions")
            .select("id")
            .eq("person_id", record.person_id)
            .ilike("name", extracted.name)
            .is("deleted_at", null)
            .maybeSingle();

          if (existing) {
            conditionId = existing.id;
          } else {
            // Create new condition (store ICD code even if validation failed - user can correct)
            const { data: newCondition, error: conditionError } = await supabaseAdmin
              .from("conditions")
              .insert({
                person_id: record.person_id,
                name: extracted.name,
                code: extracted.icd_code || null,
                icd_name_en: icdLookupResult?.name_en || null,
                icd_name_ru: icdLookupResult?.name_ru || null,
                current_status: extracted.status,
              })
              .select("id")
              .single();

            if (conditionError || !newCondition) {
              console.error("Error creating condition:", conditionError);
              continue;
            }
            conditionId = newCondition.id;
          }
        } else {
          // Neither existing_condition_id nor name provided - skip
          console.warn("Skipping condition without existing_condition_id or name");
          continue;
        }

        // Create condition_record linking condition to this record
        const { error: crError } = await supabaseAdmin.from("condition_records").insert({
          condition_id: conditionId,
          record_id: record_id,
          status_in_record: extracted.status,
          source_anchor: extracted.source_anchor,
          confidence: extracted.confidence,
          is_llm_extracted: true,
          is_user_verified: false,
        });

        if (crError) {
          console.error("Error inserting condition_record:", crError);
          // Don't fail the whole request, just log the error
        } else {
          // Recompute condition current_status from most recent mention by record_date
          // (so an older record with "Active" does not override a newer "Suspected")
          await recomputeConditionCurrentStatus(supabaseAdmin, conditionId);
        }
      }
    }

    // Process findings to resolve (create resolution entries with size=0, count=0)
    if (structuredData.findings_to_resolve.length > 0) {
      console.log(`Processing ${structuredData.findings_to_resolve.length} findings to resolve`);

      for (const toResolve of structuredData.findings_to_resolve) {
        // Find matching existing finding to get catalog IDs
        const matchingFinding = existingFindings.find((f) => {
          // Match by finding_code + site_code if available
          if (toResolve.finding_code && toResolve.site_code) {
            return f.finding_code === toResolve.finding_code && f.site_code === toResolve.site_code;
          }
          // Match by finding_code only
          if (toResolve.finding_code) {
            return f.finding_code === toResolve.finding_code;
          }
          // Match by text (fallback)
          const findingTextMatch =
            f.finding_type_text.toLowerCase().trim() ===
            toResolve.finding_type_text.toLowerCase().trim();
          const siteTextMatch =
            !toResolve.body_site_text ||
            f.body_site_text?.toLowerCase().trim() ===
              toResolve.body_site_text.toLowerCase().trim();
          return findingTextMatch && siteTextMatch;
        });

        if (!matchingFinding) {
          console.warn(
            `Could not find matching existing finding to resolve: ${toResolve.finding_type_text}`,
          );
          continue;
        }

        // Create resolution entry (finding with size=0, count=0)
        const { error: resolveError } = await supabaseAdmin.from("record_findings").insert({
          person_id: record.person_id,
          record_id,
          finding_type_id: matchingFinding.finding_type_id,
          finding_code: matchingFinding.finding_code,
          finding_type_text: matchingFinding.finding_type_text,
          body_site_id: matchingFinding.body_site_id,
          site_code: matchingFinding.site_code,
          body_site_text: matchingFinding.body_site_text,
          size_mm: 0,
          count: 0,
          severity: "unknown",
          laterality: "none",
          finding_date: structuredData.record_date || null,
          source_anchor: toResolve.source_anchor || `Resolved: ${toResolve.reason}`,
          is_llm_extracted: true,
          is_user_verified: false,
          confidence: toResolve.confidence,
        });

        if (resolveError) {
          console.error("Error creating resolution entry for finding:", resolveError);
        } else {
          console.log(
            `Created resolution entry for finding: ${matchingFinding.finding_type_text} at ${matchingFinding.body_site_text || matchingFinding.site_code}`,
          );
        }
      }
    }

    // Process conditions to resolve (update status and create condition_record)
    if (structuredData.conditions_to_resolve.length > 0) {
      console.log(
        `Processing ${structuredData.conditions_to_resolve.length} conditions to resolve`,
      );

      for (const toResolve of structuredData.conditions_to_resolve) {
        if (!toResolve.condition_id) {
          console.warn("Skipping condition to resolve without condition_id");
          continue;
        }

        // Verify the condition exists and belongs to this person
        const existingCond = existingConditions.find((c) => c.id === toResolve.condition_id);
        if (!existingCond) {
          console.warn(
            `Condition to resolve not found in existing conditions: ${toResolve.condition_id}`,
          );
          continue;
        }

        // Create condition_record linking to this record (status "resolved" in this record)
        const { error: crError } = await supabaseAdmin.from("condition_records").insert({
          condition_id: toResolve.condition_id,
          record_id: record_id,
          status_in_record: "resolved",
          source_anchor: toResolve.source_anchor,
          confidence: toResolve.confidence,
          is_llm_extracted: true,
          is_user_verified: false,
        });

        if (crError) {
          console.error("Error inserting condition_record for resolved condition:", crError);
        } else {
          // Recompute condition current_status from most recent mention by record_date
          await recomputeConditionCurrentStatus(supabaseAdmin, toResolve.condition_id);
          console.log(`Marked condition as resolved: ${existingCond.name}`);
        }
      }
    }

    // Return structured data with observations, findings, and conditions
    return new Response(
      JSON.stringify({
        success: true,
        structured_data: structuredData,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      },
    );
  } catch (error) {
    console.error("Structure extraction error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      },
    );
  }
});
