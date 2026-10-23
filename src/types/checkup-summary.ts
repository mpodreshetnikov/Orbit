import type { CheckupCompletion, CheckupItem, CheckupSchedule, CheckupWhyLink } from "./checkup";

// Normalize a single why_link from DB (may have missing label or different shape)
function normalizeWhyLink(link: unknown): CheckupWhyLink | null {
  if (!link || typeof link !== "object") return null;
  const o = link as Record<string, unknown>;
  const type = o.type as string | undefined;
  const id = typeof o.id === "string" ? o.id : undefined;
  if (type !== "condition" || !id) return null;
  const label = typeof o.label === "string" ? o.label : id;
  return { type: "condition", id, label };
}

/** A `checkup_items` row with its jsonb schedule and links in their typed shapes. */
export function rowToCheckupItem(row: Record<string, unknown>): CheckupItem {
  const schedule = row.schedule as CheckupSchedule;
  const rawWhyLinks = row.why_links;
  const whyLinks: CheckupWhyLink[] = Array.isArray(rawWhyLinks)
    ? rawWhyLinks.map(normalizeWhyLink).filter((l): l is CheckupWhyLink => l != null)
    : [];
  const rawReminder = row.reminder_days_before;
  const reminderDaysBefore: number[] = Array.isArray(rawReminder)
    ? rawReminder.filter((x): x is number => typeof x === "number")
    : [7];
  return {
    id: row.id as string,
    person_id: row.person_id as string,
    title: row.title as string,
    category: row.category as CheckupItem["category"],
    schedule,
    next_due_at: (row.next_due_at as string | null) ?? null,
    status: row.status as CheckupItem["status"],
    reminder_days_before: reminderDaysBefore,
    planned_on: (row.planned_on as string | null) ?? null,
    why_text: (row.why_text as string | null) ?? null,
    why_links: whyLinks,
    notes: (row.notes as string | null) ?? null,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

export function rowToCheckupCompletion(row: Record<string, unknown>): CheckupCompletion {
  return {
    id: row.id as string,
    checkup_item_id: row.checkup_item_id as string,
    done_at: row.done_at as string,
    note: (row.note as string | null) ?? null,
    evidence_record_id: (row.evidence_record_id as string | null) ?? null,
    created_at: row.created_at as string,
  };
}

/** `YYYY-MM-DD` of an instant, as the checkup pages compare due dates: the local calendar day. */
export function isoDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Whether an active checkup is late: past its due date, or past the day it was planned for while
 * its due date is still ahead.
 */
export function checkupLateness(item: CheckupItem, today: string) {
  const active = item.status === "active";
  const byDue = active && item.next_due_at != null && item.next_due_at < today;
  const byPlan =
    active &&
    item.planned_on != null &&
    item.planned_on < today &&
    (!item.next_due_at || item.next_due_at >= today);
  return { byDue, byPlan };
}

/** The checkups page's search: by title. */
export function searchCheckups(items: CheckupItem[], query: string): CheckupItem[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return items;
  return items.filter((item) => item.title.toLowerCase().includes(needle));
}

/**
 * The checkups page's groups: overdue (by due date or by plan), upcoming within the week, later,
 * and the rest — inactive ones and active ones with nothing due.
 */
export function groupCheckups(items: CheckupItem[], now: Date) {
  const today = isoDay(now);
  const weekAhead = new Date(now);
  weekAhead.setDate(weekAhead.getDate() + 7);
  const weekEnd = isoDay(weekAhead);

  const overdue = items.filter(
    (i) =>
      i.status === "active" &&
      ((i.next_due_at && i.next_due_at < today) || (i.planned_on && i.planned_on < today)),
  );
  const overdueIds = new Set(overdue.map((i) => i.id));
  const ahead = items.filter(
    (i) => !overdueIds.has(i.id) && i.status === "active" && i.next_due_at,
  );
  const upcoming = ahead.filter(
    (i) => (i.next_due_at as string) >= today && (i.next_due_at as string) <= weekEnd,
  );
  const later = ahead.filter((i) => (i.next_due_at as string) > weekEnd);
  const rest = items.filter(
    (i) => i.status !== "active" || (!i.next_due_at && !(i.planned_on && i.planned_on < today)),
  );
  return { overdue, upcoming, later, rest };
}
