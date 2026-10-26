import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import {
  addProposedCheckups,
  reviewCheckupProposals,
  type ProposedCheckup,
  type ReviewedCheckup,
} from "../health/checkups";
import { isoDateSchema, personSelectorSchema, uuidSchema } from "../schemas/common";
import { withPerson } from "../tool-context";
import { fail, ok } from "../tool-result";
import { WRITE_SCOPE } from "../tools/scopes";
import { RECORD_DRAFT_RESOURCE_URI } from "./record-draft";

/**
 * A new scheduled checkup, proposed by the owner's Claude and added only from a card (T-261026-y7c).
 *
 * A document often says what to do next ("контроль через 3 месяца") and, until this, the agent had
 * no way to put that on the schedule. `propose_checkup` writes nothing: it checks the proposal and
 * returns it as a card, the record draft card's third mode, whose Add calls the card-only
 * `add_proposed_checkups` with the same items. That re-checks them, so a checkup added in the
 * meantime is not added twice.
 */

const CATEGORY_LABELS: Record<ProposedCheckup["category"], string> = {
  lab: "Анализы",
  imaging: "Диагностика",
  visit: "Приём врача",
  vaccination: "Вакцинация",
  dental: "Стоматология",
  other: "Другое",
};

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export function scheduleLabel(schedule: ProposedCheckup["schedule"]): string {
  if (schedule.type === "one_off") return "однократно";
  const words = {
    week: ["неделю", "недели", "недель"],
    month: ["месяц", "месяца", "месяцев"],
    year: ["год", "года", "лет"],
  }[schedule.unit];
  if (schedule.every === 1) return `раз в ${words[0]}`;
  // "раз в 3 месяца", "раз в 21 неделю": the accusative after "в" takes the counting forms as-is.
  return `раз в ${schedule.every} ${plural(schedule.every, words[0], words[1], words[2])}`;
}

export interface CheckupProposalItem {
  title: string;
  category_label: string;
  schedule_label: string;
  first_due_at: string;
  why: string;
  condition_name: string | null;
  /** What the card sends back on Add, unchanged. */
  input: ProposedCheckup;
}

export interface CheckupProposalView {
  person_id: string;
  person_name: string;
  evidence_record_id: string | null;
  evidence_label: string | null;
  items: CheckupProposalItem[];
}

function russianDate(day: string | null): string | null {
  if (!day) return null;
  const date = new Date(`${day.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return day;
  return date.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function buildCheckupProposalView(input: {
  person: { id: string; name: string };
  accepted: ReviewedCheckup[];
  evidence: { record_id: string; title: string; record_date: string | null } | null;
}): CheckupProposalView {
  return {
    person_id: input.person.id,
    person_name: input.person.name,
    evidence_record_id: input.evidence?.record_id ?? null,
    evidence_label: input.evidence
      ? [input.evidence.title, russianDate(input.evidence.record_date)].filter(Boolean).join(", ")
      : null,
    items: input.accepted.map((item) => ({
      title: item.input.title.trim(),
      category_label: CATEGORY_LABELS[item.input.category],
      schedule_label: scheduleLabel(item.input.schedule),
      first_due_at: item.first_due_at,
      why: item.input.why.trim(),
      condition_name: item.condition_name,
      input: item.input,
    })),
  };
}

const proposedCheckupSchema = z.object({
  title: z.string().min(1).describe('As the owner would name it, e.g. "УЗИ щитовидной железы".'),
  category: z.enum(["lab", "imaging", "visit", "vaccination", "dental", "other"]),
  schedule: z.discriminatedUnion("type", [
    z.object({
      type: z.literal("interval"),
      every: z.number().int().min(1).max(120),
      unit: z.enum(["week", "month", "year"]),
    }),
    z.object({ type: z.literal("one_off"), due_at: isoDateSchema }),
  ]),
  first_due_at: isoDateSchema
    .nullable()
    .optional()
    .describe(
      "For an interval: when it is first due, e.g. the date the document says to come back. Without it, one interval from today.",
    ),
  why: z
    .string()
    .min(1)
    .describe("Why, in the owner's language: what the document or doctor says."),
  condition_id: uuidSchema
    .nullable()
    .optional()
    .describe("The condition it follows, from get_ingest_candidates or list_conditions."),
});

type ProposeArgs = {
  person_id?: string;
  person_name?: string;
  checkups: ProposedCheckup[];
  evidence_record_id?: string | null;
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function registerCheckupProposalApp(server: Pick<McpServer, "registerTool">) {
  server.registerTool(
    "propose_checkup",
    {
      title: "Propose a new checkup",
      description:
        'Propose new scheduled checkups for a person, e.g. a follow-up a document asks for ("контроль через 3 месяца") or a screening they lack, shown as a card the owner adds them from. Nothing is scheduled until the owner presses Add on the card; end your turn and wait: when they press a button the card posts a short message from them in the chat, and the outcome is in your context. Check list_checkups first: a checkup they already have is refused, so complete it (ingest\'s checkups_to_complete or propose_reconciliation) instead of proposing it again.',
      inputSchema: z.object({
        ...personSelectorSchema,
        checkups: z.array(proposedCheckupSchema).min(1).max(10),
        evidence_record_id: uuidSchema
          .nullable()
          .optional()
          .describe("The record that asks for it, if one does."),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: {
        ui: { resourceUri: RECORD_DRAFT_RESOURCE_URI },
        "ui/resourceUri": RECORD_DRAFT_RESOURCE_URI,
      },
    },
    withPerson<ProposeArgs>(async (supabase, person, args) => {
      const review = await reviewCheckupProposals(
        supabase,
        person.id,
        args.checkups,
        args.evidence_record_id ?? null,
        today(),
      );
      const lines: string[] = [];
      if (review.accepted.length > 0) {
        lines.push(
          `Showing ${review.accepted.length} proposed checkup(s) for ${person.name} on a card: ${review.accepted.map((item) => `"${item.input.title}" first due ${item.first_due_at}`).join(", ")}. Nothing is scheduled until the owner presses Add on the card; end your turn and wait: when they press a button the card posts a short message from them in the chat, and the outcome is in your context.`,
        );
      }
      if (review.refused.length > 0) {
        lines.push(
          `Refused ${review.refused.length}:`,
          ...review.refused.map((item) => `- "${item.title}": ${item.reason}`),
        );
      }
      if (review.accepted.length === 0) {
        return fail(lines.join("\n"), { refused: review.refused });
      }
      return ok(lines.join("\n"), {
        checkup_proposal: buildCheckupProposalView({
          person,
          accepted: review.accepted,
          evidence: review.evidence,
        }),
        refused: review.refused,
      });
    }),
  );

  server.registerTool(
    "add_proposed_checkups",
    {
      title: "Add proposed checkups",
      description:
        "Used by the proposed checkup card's Add button: schedules the checkups the card shows, checking each again first.",
      inputSchema: z.object({
        person_id: uuidSchema,
        checkups: z.array(proposedCheckupSchema).min(1).max(10),
        evidence_record_id: uuidSchema.nullable().optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      _meta: { ui: { visibility: ["app"] } },
    },
    withPerson<ProposeArgs>(async (supabase, person, args) => {
      const review = await reviewCheckupProposals(
        supabase,
        person.id,
        args.checkups,
        args.evidence_record_id ?? null,
        today(),
      );
      const added = await addProposedCheckups(supabase, person.id, review);
      const lines = [
        added.length > 0
          ? `Scheduled for ${person.name}: ${added.map((row) => `"${row.title}" (due ${row.next_due_at ?? "not set"})`).join(", ")}.`
          : `Nothing scheduled for ${person.name}.`,
      ];
      if (review.refused.length > 0) {
        lines.push(
          `Not added ${review.refused.length}:`,
          ...review.refused.map((item) => `- "${item.title}": ${item.reason}`),
        );
      }
      return ok(lines.join("\n"), { added, refused: review.refused });
    }, WRITE_SCOPE),
  );
}
