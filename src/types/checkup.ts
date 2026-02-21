// ============================================================================
// CHECKUP TYPES (checkup_items + checkup_completions, no checkup_plans)
// ============================================================================

export type CheckupCategory = "lab" | "imaging" | "visit" | "vaccination" | "dental" | "other";

export type CheckupItemStatus = "active" | "paused" | "completed" | "archived";

export const CHECKUP_CATEGORIES: CheckupCategory[] = [
  "lab",
  "imaging",
  "visit",
  "vaccination",
  "dental",
  "other",
];

export const CHECKUP_ITEM_STATUSES: CheckupItemStatus[] = [
  "active",
  "paused",
  "completed",
  "archived",
];

/** When to set next due date after completion: from completion date or from target (scheduled) date */
export type CheckupNextDueFrom = "completion" | "target";

// Schedule: discriminated union
export type CheckupScheduleInterval = {
  type: "interval";
  every: number;
  unit: "week" | "month" | "year";
  anchor_date?: string; // ISO date, optional
  /** For recurring: next due = completion date + interval (default) or target date + interval */
  next_due_from?: CheckupNextDueFrom;
};

export type CheckupScheduleOneOff = {
  type: "one_off";
  due_at: string; // ISO date
};

export type CheckupSchedule = CheckupScheduleInterval | CheckupScheduleOneOff;

export function isCheckupScheduleInterval(s: CheckupSchedule): s is CheckupScheduleInterval {
  return s.type === "interval";
}

export function isCheckupScheduleOneOff(s: CheckupSchedule): s is CheckupScheduleOneOff {
  return s.type === "one_off";
}

// Why link: extensible (condition, etc.)
export interface CheckupWhyLink {
  type: "condition";
  id: string;
  label: string;
}

// ============================================================================
// checkup_items table
// ============================================================================

export interface CheckupItem {
  id: string;
  person_id: string;
  title: string;
  category: CheckupCategory;
  schedule: CheckupSchedule;
  next_due_at: string | null;
  status: CheckupItemStatus;
  reminder_days_before: number[];
  planned_on: string | null;
  why_text: string | null;
  why_links: CheckupWhyLink[];
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateCheckupItemInput {
  person_id: string;
  title: string;
  category: CheckupCategory;
  schedule: CheckupSchedule;
  reminder_days_before?: number[];
  why_text?: string | null;
  why_links?: CheckupWhyLink[];
  notes?: string | null;
}

export interface UpdateCheckupItemInput {
  title?: string;
  category?: CheckupCategory;
  schedule?: CheckupSchedule;
  status?: CheckupItemStatus;
  reminder_days_before?: number[];
  planned_on?: string | null;
  why_text?: string | null;
  why_links?: CheckupWhyLink[];
  notes?: string | null;
}

// ============================================================================
// checkup_completions table
// ============================================================================

export interface CheckupCompletion {
  id: string;
  checkup_item_id: string;
  done_at: string;
  note: string | null;
  evidence_record_id: string | null;
  created_at: string;
}

export interface CreateCheckupCompletionInput {
  checkup_item_id: string;
  done_at: string; // ISO date
  note?: string | null;
  evidence_record_id?: string | null;
}

export interface UpdateCheckupCompletionInput {
  done_at?: string;
  note?: string | null;
  evidence_record_id?: string | null;
}

// ============================================================================
// Filters for list/dashboard
// ============================================================================

export interface CheckupItemsFilters {
  category?: CheckupCategory | null;
  status?: CheckupItemStatus | null;
  dueWindow?: "overdue" | "upcoming" | "all" | null;
  conditionId?: string | null;
}
