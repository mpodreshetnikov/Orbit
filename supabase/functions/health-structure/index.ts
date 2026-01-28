import { createClient } from "https://esm.sh/@supabase/supabase-js@2.91.1";
import { corsHeaders } from "../_shared/cors.ts";

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
  existing_condition_id: string | null;  // ID from existing conditions list
  name: string;                          // Name (required for new, optional for existing)
  icd_code: string | null;               // ICD-10 code (e.g., "D50.9", "E11.9")
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
  code: string | null;  // ICD-10 code
  current_status: string;
  onset_date: string | null;
  resolved_date: string | null;
}

interface StructuredDataWithObservationsAndFindings extends StructuredData {
  observations: ExtractedObservation[];
  findings: ExtractedFinding[];
  conditions: ExtractedCondition[];
}

// Fetch observation catalog from database
async function fetchObservationCatalog(supabase: ReturnType<typeof createClient>): Promise<ObservationCatalogItem[]> {
  const { data, error } = await supabase
    .from("observation_catalog")
    .select("id, obs_code, name_ru, name_en, canonical_unit, synonyms_ru, synonyms_en, accepted_units")
    .order("obs_code");

  if (error) {
    console.error("Error fetching observation catalog:", error);
    return [];
  }

  return data || [];
}

// Fetch finding type catalog from database
async function fetchFindingTypeCatalog(supabase: ReturnType<typeof createClient>): Promise<FindingTypeCatalogItem[]> {
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
async function fetchBodySiteCatalog(supabase: ReturnType<typeof createClient>): Promise<BodySiteCatalogItem[]> {
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
  supabase: ReturnType<typeof createClient>,
  personId: string
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

// Build observation catalog prompt section
function buildObservationCatalogPrompt(catalog: ObservationCatalogItem[]): string {
  if (catalog.length === 0) {
    return "Каталог показателей пуст. Извлекай показатели без привязки к коду.";
  }

  const items = catalog.map(item => {
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

  const items = catalog.map(item => {
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

  const items = catalog.map(item => {
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

  const items = conditions.map(c => {
    const dates = [];
    if (c.onset_date) dates.push(`начало: ${c.onset_date}`);
    if (c.resolved_date) dates.push(`окончание: ${c.resolved_date}`);
    const dateStr = dates.length > 0 ? ` (${dates.join(", ")})` : "";
    const codeStr = c.code ? `код: ${c.code} | ` : "";
    return `- ID: "${c.id}" | ${codeStr}"${c.name}" | статус: ${c.current_status}${dateStr}`;
  });

  return `СУЩЕСТВУЮЩИЕ ДИАГНОЗЫ ПАЦИЕНТА:
${items.join("\n")}

ВАЖНО: Если документ упоминает один из существующих диагнозов (или его синоним/вариацию):
- Используй existing_condition_id с ID из списка выше
- Если у существующего диагноза есть МКБ-10 код — сопоставляй по нему!
- Укажи НОВЫЙ статус если он изменился (например, "resolved" если вылечено)
- name можно оставить пустым или указать как в документе

Если диагноз НОВЫЙ (не найден в списке выше):
- existing_condition_id = null
- name = название диагноза из документа
- icd_code = код МКБ-10 если известен`;
}

// Call LLM to extract structured data from OCR text
async function extractStructuredData(
  ocrText: string,
  observationCatalog: ObservationCatalogItem[],
  findingTypeCatalog: FindingTypeCatalogItem[],
  bodySiteCatalog: BodySiteCatalogItem[],
  existingConditions: ExistingCondition[]
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
    };
  }

  const observationCatalogPrompt = buildObservationCatalogPrompt(observationCatalog);
  const findingTypeCatalogPrompt = buildFindingTypeCatalogPrompt(findingTypeCatalog);
  const bodySiteCatalogPrompt = buildBodySiteCatalogPrompt(bodySiteCatalog);
  const existingConditionsPrompt = buildExistingConditionsPrompt(existingConditions);

  const systemPrompt = `Ты — анализатор медицинских документов. Тебе будет дан текст, извлечённый из медицинского документа (OCR).

Твоя задача: проанализировать текст и извлечь структурированную информацию.

Ответь JSON-объектом с полями:
- record_type: одно из "lab", "visit", "imaging", "prescription", "vaccination", "vet", "other"
- title: короткое описательное название записи НА РУССКОМ ЯЗЫКЕ (максимум 100 символов)
- record_date: дата документа в формате YYYY-MM-DD, или null если не найдена
- summary: ОЧЕНЬ КРАТКОЕ и ПОЛЕЗНОЕ описание результата НА РУССКОМ ЯЗЫКЕ (1-2 коротких предложения, максимум 150 символов)
- keywords: массив из 3-7 релевантных ключевых слов/тегов НА РУССКОМ ЯЗЫКЕ
- observations: массив извлечённых показателей/результатов анализов
- findings: массив извлечённых находок (полипы, камни, кисты, образования и т.д.)
- conditions: массив извлечённых диагнозов/заболеваний

ВАЖНЫЕ ПРАВИЛА ДЛЯ ТИПА (record_type):
- Если документ упоминает животных или ветеринарную помощь: "vet"
- Для анализов крови, мочи и т.д.: "lab"
- Для рентгена, МРТ, КТ, УЗИ: "imaging"
- Для рецептов или назначений лекарств: "prescription"
- Для записей о вакцинации: "vaccination"
- Для консультаций врача или записей о приёме: "visit"
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
- Показатели анализов — они идут в observations`;

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
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
      max_tokens: 8192, // Increased for observations + findings
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
    return {
      record_type: parsed.record_type || "other",
      title: parsed.title || "Медицинский документ",
      record_date: parsed.record_date || null,
      summary: parsed.summary || "",
      keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
      observations: Array.isArray(parsed.observations) ? parsed.observations.map((obs: Partial<ExtractedObservation>) => ({
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
      })) : [],
      findings: Array.isArray(parsed.findings) ? parsed.findings.map((f: Partial<ExtractedFinding>) => ({
        finding_code: f.finding_code || null,
        finding_type_text: f.finding_type_text || "Неизвестная находка",
        site_code: f.site_code || null,
        body_site_text: f.body_site_text || null,
        size_mm: typeof f.size_mm === "number" ? f.size_mm : null,
        count: typeof f.count === "number" ? f.count : null,
        severity: (f.severity === "mild" || f.severity === "moderate" || f.severity === "severe") ? f.severity : "unknown",
        laterality: (f.laterality === "left" || f.laterality === "right" || f.laterality === "bilateral") ? f.laterality : "none",
        morphology: f.morphology || null,
        description: f.description || null,
        histology: f.histology || null,
        finding_date: f.finding_date || null,
        source_anchor: f.source_anchor || "",
        confidence: typeof f.confidence === "number" ? f.confidence : 0.8,
      })) : [],
      conditions: Array.isArray(parsed.conditions) ? parsed.conditions.map((c: Partial<ExtractedCondition>) => ({
        existing_condition_id: c.existing_condition_id || null,
        name: c.name || "",
        icd_code: c.icd_code || null,
        status: (c.status === "active" || c.status === "resolved" || c.status === "suspected" || c.status === "history") ? c.status : "suspected",
        confidence: typeof c.confidence === "number" ? c.confidence : 0.8,
        source_anchor: c.source_anchor || null,
      })) : [],
    };
  } catch {
    throw new Error("Failed to parse OpenRouter response as JSON");
  }
}

// Find catalog entry by obs_code
function findCatalogEntry(
  obsCode: string | null,
  catalog: ObservationCatalogItem[]
): ObservationCatalogItem | null {
  if (!obsCode) return null;
  return catalog.find(c => c.obs_code === obsCode) || null;
}

// Find finding type catalog entry by finding_code
function findFindingTypeCatalogEntry(
  findingCode: string | null,
  catalog: FindingTypeCatalogItem[]
): FindingTypeCatalogItem | null {
  if (!findingCode) return null;
  return catalog.find(c => c.finding_code === findingCode) || null;
}

// Find body site catalog entry by site_code
function findBodySiteCatalogEntry(
  siteCode: string | null,
  catalog: BodySiteCatalogItem[]
): BodySiteCatalogItem | null {
  if (!siteCode) return null;
  return catalog.find(c => c.site_code === siteCode) || null;
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
  catalogEntry: ObservationCatalogItem | null
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
  unitConfig: { factor_to_canonical?: number; formula_to_canonical?: string } | null
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
  catalogEntry: ObservationCatalogItem | null
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
  catalogEntry: ObservationCatalogItem | null
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
    const supabaseClient = createClient(
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
      }
    );

    // Verify user is authenticated by getting user info
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token);
    
    if (authError || !user) {
      console.error("Auth error:", authError);
      throw new Error("Unauthorized - invalid token");
    }

    // Check allowlist using service role (bypasses RLS)
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
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

    // Fetch all catalogs and existing conditions for LLM context
    const [observationCatalog, findingTypeCatalog, bodySiteCatalog, existingConditions] = await Promise.all([
      fetchObservationCatalog(supabaseAdmin),
      fetchFindingTypeCatalog(supabaseAdmin),
      fetchBodySiteCatalog(supabaseAdmin),
      fetchPersonConditions(supabaseAdmin, record.person_id),
    ]);
    console.log(`Loaded ${observationCatalog.length} observation catalog entries`);
    console.log(`Loaded ${findingTypeCatalog.length} finding type catalog entries`);
    console.log(`Loaded ${bodySiteCatalog.length} body site catalog entries`);
    console.log(`Loaded ${existingConditions.length} existing conditions for person`);

    // Extract structured data from OCR text
    const structuredData = await extractStructuredData(
      record.ocr_text,
      observationCatalog,
      findingTypeCatalog,
      bodySiteCatalog,
      existingConditions
    );
    console.log(`Extracted ${structuredData.observations.length} observations`);
    console.log(`Extracted ${structuredData.findings.length} findings`);
    console.log(`Extracted ${structuredData.conditions.length} conditions`);
    console.log("Extracted observations:", JSON.stringify(structuredData.observations, null, 2));
    console.log("Extracted findings:", JSON.stringify(structuredData.findings, null, 2));
    console.log("Extracted conditions:", JSON.stringify(structuredData.conditions, null, 2));

    // Update the medical record with structured data
    const { error: updateError } = await supabaseAdmin
      .from("medical_records")
      .update({
        title: structuredData.title,
        record_type: structuredData.record_type,
        record_date: structuredData.record_date,
        notes: structuredData.summary,
        llm_summary: structuredData.summary,
        llm_keywords: structuredData.keywords,
        status: "structure_review", // Ready for user to review structured data
      })
      .eq("id", record_id);

    if (updateError) {
      throw new Error(`Failed to update record: ${updateError.message}`);
    }

    // Delete existing observations for this record (in case of re-extraction)
    await supabaseAdmin
      .from("record_observations")
      .delete()
      .eq("record_id", record_id);

    // Insert extracted observations
    if (structuredData.observations.length > 0) {
      const observationsToInsert = structuredData.observations.map(obs => {
        const catalogEntry = findCatalogEntry(obs.obs_code, observationCatalog);
        const { value_canonical, unit_canonical } = convertToCanonical(
          obs.value_numeric,
          obs.unit,
          catalogEntry
        );
        const { ref_range_low_canonical, ref_range_high_canonical } = convertRefRangeToCanonical(
          obs.ref_range_low,
          obs.ref_range_high,
          obs.unit,
          catalogEntry
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
    await supabaseAdmin
      .from("record_findings")
      .delete()
      .eq("record_id", record_id);

    // Insert extracted findings
    if (structuredData.findings.length > 0) {
      const findingsToInsert = structuredData.findings
        .filter(f => f.source_anchor && f.source_anchor.trim().length > 0) // source_anchor is required
        .map(f => {
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
            finding_date: f.finding_date,
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
    await supabaseAdmin
      .from("condition_records")
      .delete()
      .eq("record_id", record_id);

    // Helper function to lookup ICD code via icd-lookup edge function
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

    // Process extracted conditions
    if (structuredData.conditions.length > 0) {
      for (const extracted of structuredData.conditions) {
        let conditionId: string;
        let shouldUpdateStatus = false;
        let icdLookupResult: IcdLookupResult | null = null;

        // If there's an ICD code, validate it first
        if (extracted.icd_code) {
          icdLookupResult = await lookupIcdCode(extracted.icd_code);
          console.log(`ICD lookup for ${extracted.icd_code}:`, icdLookupResult);
        }

        if (extracted.existing_condition_id) {
          // LLM matched to existing condition
          conditionId = extracted.existing_condition_id;

          // Check if we should update the condition's current_status
          const existingCond = existingConditions.find(c => c.id === conditionId);
          if (existingCond && existingCond.current_status !== extracted.status) {
            // Status changed - update the condition
            shouldUpdateStatus = true;
          }

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
            console.log(`Found existing condition by ICD code ${extracted.icd_code}: ${conditionId}`);
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
            console.log(`Created new condition with ICD code ${extracted.icd_code}: ${conditionId}`);
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

        // Update condition status if needed (will be reviewed by user)
        if (shouldUpdateStatus) {
          await supabaseAdmin
            .from("conditions")
            .update({ current_status: extracted.status })
            .eq("id", conditionId);
        }

        // Create condition_record linking condition to this record
        const { error: crError } = await supabaseAdmin
          .from("condition_records")
          .insert({
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
      }
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
      }
    );
  }
});
