/**
 * What a document looks able to close, and whether a submission has ruled on it (T-261026-y7c).
 *
 * Over MCP the owner's Claude decides what a document closes, and `health-ingest` gates what it
 * proposes. Left optional, that decision was simply never made: on 2026-10-26 fifteen documents
 * arrived and not one said what it closed, so two deficiencies the labs had ended stayed active
 * and eight checkups they covered stayed overdue. So `ingest_medical_document` now refuses a
 * submission that has not ruled on what the server can see the document touching.
 *
 * The server's view here is deliberately a hint, not a decision. Checkups carry only a free-text
 * title and a schedule, no catalogue codes, so the best the server can do is "due in the period
 * this document dates from, and its title's words are in the text". The agent rules on each one;
 * nothing below closes anything.
 */

export interface GateCondition {
  id: string;
  name: string;
  code: string | null;
  current_status: string;
}

export interface GateCheckup {
  id: string;
  title: string;
  category: string;
  schedule: unknown;
  next_due_at: string | null;
  last_done_at: string | null;
}

export interface ReconciliationSuggestion {
  kind: "condition" | "checkup";
  id: string;
  label: string;
  reason: string;
}

export interface ReconciliationContext {
  /** Asked about by name: a strong reason to think the document speaks to it. */
  suggestions: ReconciliationSuggestion[];
  /** Due in the period the document dates from, with no word of their title in it. */
  alsoDue: ReconciliationSuggestion[];
}

/**
 * The analytes that decide a condition on their own, mirroring the condition side of
 * `RESOLVING_ANALYTES` in `supabase/functions/health-structure/resolution.ts`, plus the labels a
 * printed report uses for the analyte. Only a hint for the agent: the edge gate still decides
 * whether a closure citing one is accepted.
 */
const DECIDING_ANALYTES: Array<{
  analyte: string;
  icdPrefixes: string[];
  conditionPatterns: string[];
  labelPatterns: string[];
}> = [
  {
    analyte: "vitamin B12",
    icdPrefixes: ["E53.8"],
    conditionPatterns: ["b12", "в12", "кобаламин"],
    labelPatterns: ["b12", "в12", "кобаламин", "cobalamin"],
  },
  {
    analyte: "vitamin D (25-OH)",
    icdPrefixes: ["E55"],
    conditionPatterns: ["витамин d", "витамин д", "витамина d", "витамина д", "25-oh"],
    labelPatterns: ["витамин d", "витамин д", "25-oh", "25(oh)", "25 oh", "кальцидиол"],
  },
  {
    analyte: "ferritin and haemoglobin",
    icdPrefixes: ["D50", "E61.1"],
    conditionPatterns: ["железодефицит", "жда", "iron deficiency"],
    labelPatterns: ["ферритин", "ferritin"],
  },
];

/** Words too common in diagnosis names to say anything about which one a document is about. */
const GENERIC_WORDS = new Set([
  "дефицит",
  "недостаточность",
  "витамина",
  "хронический",
  "хроническая",
  "острый",
  "острая",
  "синдром",
  "болезнь",
  "заболевание",
  "состояние",
  "неуточненный",
  "неуточненная",
  "подозрение",
  "другие",
  "нарушение",
  "инфекция",
]);

/**
 * Words a checkup title uses that a report does not print, mapped to words it does. A blood count
 * is titled "ОАК" and printed as haemoglobin and leukocytes; a lipid profile prints cholesterol.
 */
const TITLE_SYNONYMS: Record<string, string[]> = {
  оак: ["общий анализ крови", "гемоглобин", "лейкоцит", "эритроцит", "тромбоцит"],
  клинический: ["общий анализ крови", "гемоглобин"],
  оам: ["общий анализ мочи", "удельный вес", "относительная плотность"],
  моча: ["анализ мочи", "мочи"],
  мочи: ["анализ мочи"],
  липидный: ["холестерин", "лпнп", "лпвп", "триглицерид"],
  липидограмма: ["холестерин", "лпнп", "лпвп", "триглицерид"],
  липиды: ["холестерин", "лпнп", "лпвп", "триглицерид"],
  зппп: ["вич", "сифилис", "гепатит", "хламид", "гонор", "трепонем"],
  ппп: ["вич", "сифилис", "гепатит", "хламид"],
  печеночные: ["алт", "аст", "билирубин", "ггт"],
  печёночные: ["алт", "аст", "билирубин", "ггт"],
  глюкоза: ["глюкоз"],
  холестерин: ["холестерин"],
  тиреоидный: ["ттг", "т4"],
  щитовидной: ["ттг", "т4"],
};

/** Lower case, ё as е, Latin look-alikes as Cyrillic, so "B12" and "В12" read the same. */
export function normalizeText(text: string): string {
  const latinToCyrillic: Record<string, string> = {
    a: "а",
    b: "в",
    c: "с",
    e: "е",
    h: "н",
    k: "к",
    m: "м",
    o: "о",
    p: "р",
    t: "т",
    x: "х",
    y: "у",
  };
  return text
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[abcehkmoptxy]/g, (letter) => latinToCyrillic[letter] ?? letter);
}

function words(text: string): string[] {
  return normalizeText(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 0);
}

/** The part of a word that survives Russian endings: "описторхоз" finds "описторхоза". */
function stem(word: string): string {
  return word.length <= 5 ? word : word.slice(0, Math.max(5, word.length - 3));
}

function addInterval(date: Date, every: number, unit: string, sign: 1 | -1): Date {
  const result = new Date(date.getTime());
  const step = every * sign;
  if (unit === "week") result.setUTCDate(result.getUTCDate() + 7 * step);
  else if (unit === "month") result.setUTCMonth(result.getUTCMonth() + step);
  else result.setUTCFullYear(result.getUTCFullYear() + step);
  return result;
}

/**
 * Whether a document dated `recordDate` belongs to the checkup's current cycle: after its last
 * completion, not in the future, and no earlier than one interval before it falls due. A report
 * from before the last completion, or from a cycle long gone, completes nothing that is due now.
 */
export function isInCurrentCycle(checkup: GateCheckup, recordDate: string, today: string): boolean {
  if (!checkup.next_due_at) return false;
  if (recordDate > today) return false;
  if (checkup.last_done_at && recordDate <= checkup.last_done_at.slice(0, 10)) return false;

  const schedule = checkup.schedule as { type?: string; every?: unknown; unit?: unknown } | null;
  const due = new Date(`${checkup.next_due_at.slice(0, 10)}T00:00:00Z`);
  const every = typeof schedule?.every === "number" && schedule.every > 0 ? schedule.every : 1;
  const unit = typeof schedule?.unit === "string" ? schedule.unit : "year";
  const earliest = addInterval(due, every, schedule?.type === "interval" ? unit : "year", -1);
  return recordDate >= earliest.toISOString().slice(0, 10);
}

/** Words in checkup titles that name no analyte: "Витамин D" is about D, not about vitamins. */
const GENERIC_TITLE_WORDS = new Set([
  "витамин",
  "анализ",
  "общий",
  "скрининг",
  "профиль",
  "натощак",
  "контроль",
  "осмотр",
  "крови",
]);

function checkupTitleHits(title: string, text: string): string[] {
  const phrase = words(title).join(" ");
  if (phrase.length >= 3 && text.replace(/[^\p{L}\p{N}]+/gu, " ").includes(phrase)) {
    return [title];
  }
  const hits: string[] = [];
  for (const word of words(title)) {
    if (word.length < 3 || GENERIC_TITLE_WORDS.has(word)) continue;
    const probes = [stem(word), ...(TITLE_SYNONYMS[word] ?? []).map(normalizeText)];
    if (probes.some((probe) => probe.length >= 3 && text.includes(probe))) hits.push(word);
  }
  return hits;
}

export function pickReconciliationSuggestions(input: {
  conditions: GateCondition[];
  checkups: GateCheckup[];
  recordDate: string | null;
  sourceText: string;
  observationLabels: string[];
  today: string;
}): ReconciliationContext {
  const text = normalizeText([input.sourceText, ...input.observationLabels].join("\n"));
  const suggestions: ReconciliationSuggestion[] = [];
  const alsoDue: ReconciliationSuggestion[] = [];

  for (const condition of input.conditions) {
    if (condition.current_status !== "active" && condition.current_status !== "suspected") {
      continue;
    }
    const name = normalizeText(condition.name);
    const code = (condition.code ?? "").toUpperCase();
    const analyte = DECIDING_ANALYTES.find(
      (entry) =>
        (entry.icdPrefixes.some((prefix) => code.startsWith(prefix)) ||
          entry.conditionPatterns.some((pattern) => name.includes(normalizeText(pattern)))) &&
        entry.labelPatterns.some((pattern) => text.includes(normalizeText(pattern))),
    );
    if (analyte) {
      suggestions.push({
        kind: "condition",
        id: condition.id,
        label: `${condition.name}${condition.code ? ` [${condition.code}]` : ""} (${condition.current_status})`,
        reason: `this document measures ${analyte.analyte}, which decides it`,
      });
      continue;
    }
    const named = words(condition.name).filter(
      (word) => word.length >= 5 && !GENERIC_WORDS.has(word) && text.includes(stem(word)),
    );
    if (named.length > 0) {
      suggestions.push({
        kind: "condition",
        id: condition.id,
        label: `${condition.name}${condition.code ? ` [${condition.code}]` : ""} (${condition.current_status})`,
        reason: `the document mentions "${named.join('", "')}"`,
      });
    }
  }

  if (input.recordDate) {
    for (const checkup of input.checkups) {
      if (!isInCurrentCycle(checkup, input.recordDate, input.today)) continue;
      const label = `${checkup.title} (${checkup.category}), due ${checkup.next_due_at}`;
      const hits = checkupTitleHits(checkup.title, text);
      if (hits.length > 0) {
        suggestions.push({
          kind: "checkup",
          id: checkup.id,
          label,
          reason: `due in the period this document dates from, and it covers "${hits.join('", "')}"`,
        });
      } else {
        alsoDue.push({
          kind: "checkup",
          id: checkup.id,
          label,
          reason: "due in the period this document dates from",
        });
      }
    }
  }

  return { suggestions, alsoDue };
}

export interface ReconciliationDecision {
  conditions_to_resolve?: Array<{ condition_id?: unknown }>;
  findings_to_resolve?: unknown[];
  checkups_to_complete?: Array<{ checkup_item_id?: unknown }>;
  not_applicable?: Array<{ id?: unknown; reason?: unknown }>;
  nothing_to_reconcile?: boolean;
}

export type ReconciliationVerdict =
  | { ok: true }
  | { ok: false; missing: "decision" | "flag" | "rulings"; unruled: ReconciliationSuggestion[] };

/**
 * Whether the submission has decided what the document closes: it says so (closures, completions,
 * or `nothing_to_reconcile`), and every suggestion is either acted on or ruled out with a reason.
 */
export function reviewReconciliationDecision(
  context: ReconciliationContext,
  decision: ReconciliationDecision | undefined,
): ReconciliationVerdict {
  if (!decision) return { ok: false, missing: "decision", unruled: context.suggestions };

  const ruled = new Set<string>();
  for (const item of decision.conditions_to_resolve ?? []) {
    if (typeof item.condition_id === "string") ruled.add(item.condition_id);
  }
  for (const item of decision.checkups_to_complete ?? []) {
    if (typeof item.checkup_item_id === "string") ruled.add(item.checkup_item_id);
  }
  for (const item of decision.not_applicable ?? []) {
    if (typeof item.id === "string") ruled.add(item.id);
  }
  const unruled = context.suggestions.filter((suggestion) => !ruled.has(suggestion.id));
  if (unruled.length > 0) return { ok: false, missing: "rulings", unruled };

  const acted =
    (decision.conditions_to_resolve ?? []).length +
    (decision.findings_to_resolve ?? []).length +
    (decision.checkups_to_complete ?? []).length +
    (decision.not_applicable ?? []).length;
  if (acted === 0 && decision.nothing_to_reconcile !== true) {
    return { ok: false, missing: "flag", unruled: [] };
  }
  return { ok: true };
}
