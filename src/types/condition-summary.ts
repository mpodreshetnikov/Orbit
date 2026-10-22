import type { ConditionStatus, ConditionWithHistory } from "./condition";

/** The order the conditions page lists its sections in; the last two are shown dimmed. */
export const CONDITION_SECTION_ORDER: ConditionStatus[] = [
  "active",
  "suspected",
  "resolved",
  "history",
];

/** A condition matches a search by its name, its ICD name or its code. */
export function searchConditions<T extends ConditionWithHistory>(conditions: T[], query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return conditions;
  return conditions.filter(
    (condition) =>
      condition.name.toLowerCase().includes(needle) ||
      condition.icd_name_en?.toLowerCase().includes(needle) ||
      condition.code?.toLowerCase().includes(needle),
  );
}

const lastMention = (condition: ConditionWithHistory) =>
  condition.last_mentioned_date ? new Date(condition.last_mentioned_date).getTime() : 0;

/**
 * The conditions split by current status, each group most recently mentioned first, in the page's
 * order. Every status is present, empty or not.
 */
export function conditionSections<T extends ConditionWithHistory>(
  conditions: T[],
): { status: ConditionStatus; items: T[] }[] {
  return CONDITION_SECTION_ORDER.map((status) => ({
    status,
    items: conditions
      .filter((condition) => condition.current_status === status)
      .sort((a, b) => lastMention(b) - lastMention(a)),
  }));
}

/** A mention as the condition page lists it: the record it is in, dated by that record. */
export interface ConditionMentionDates {
  record_date: string | null;
  created_at: string;
}

/**
 * The mentions in timeline order, newest first, dated by their record or, without one, by when they
 * were written; undated ones last. With the count and the first and last record dates.
 */
export function conditionTimeline<T extends ConditionMentionDates>(mentions: T[]) {
  const history = [...mentions].sort((a, b) => {
    const dateA = a.record_date || a.created_at?.slice(0, 10) || "";
    const dateB = b.record_date || b.created_at?.slice(0, 10) || "";
    if (!dateA && !dateB) return 0;
    if (!dateA) return 1;
    if (!dateB) return -1;
    return dateB.localeCompare(dateA);
  });
  const dates = history
    .map((mention) => mention.record_date)
    .filter((date): date is string => date !== null)
    .sort();
  return {
    history,
    mention_count: history.length,
    first_mentioned_date: dates[0] || null,
    last_mentioned_date: dates[dates.length - 1] || null,
  };
}
