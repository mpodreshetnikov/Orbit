import { vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * An in-memory stand-in for `med_dose_events` that enforces what the database
 * enforces.
 *
 * The shared FIFO stub in `./test-support` answers whatever the test queued,
 * in call order, regardless of the query. That is fine for read paths, but
 * `logDose`'s correctness rests on two things a queue cannot express: the
 * partial unique index `idx_med_dose_events_regimen_scheduled_minute`, and the
 * fact that `mark_dose_taken`/`mark_dose_skipped` only act on rows in certain
 * statuses. A test against the queue passes whether or not the code respects
 * either, which is how a duplicate-intake defect survived a green suite.
 *
 * So this models the rows: filters are applied for real, the unique index
 * rejects a second unresolved row in the same regimen-minute, and the two RPCs
 * follow `supabase/db/functions/mark_dose_*.sql` including their inventory
 * side effects.
 *
 * Only the query shapes `logDose` uses are implemented; anything else throws
 * loudly rather than quietly returning nothing.
 */

export interface FakeDoseEvent {
  id: string;
  person_id: string;
  regimen_id: string;
  scheduled_at: string;
  actual_at: string | null;
  taken_at: string | null;
  status: string;
  planned_intake: unknown;
  note: string | null;
  deleted_at: string | null;
  created_at: string;
}

export interface FakeInventoryTransaction {
  regimen_id: string;
  event_id: string | null;
  type: "decrement" | "correction";
  amount: number;
  unit: string;
}

export interface DoseEventsFake {
  client: SupabaseClient<Database>;
  events: FakeDoseEvent[];
  inventory: FakeInventoryTransaction[];
  rpc: ReturnType<typeof vi.fn>;
  /** Forces the next call to `table` to fail, the way an outage would. */
  failNext: (table: "med_dose_events" | "rpc", message: string) => void;
  /** Makes the RPC report failure while still applying its effects. */
  loseRpcResponse: (message: string) => void;
}

const UNRESOLVED = new Set(["scheduled", "sent"]);

function minuteKey(row: { regimen_id: string; scheduled_at: string }): string {
  return `${row.regimen_id}@${row.scheduled_at.slice(0, 16)}`;
}

export function createDoseEventsFake(params: {
  regimen: Record<string, unknown>;
  events?: Partial<FakeDoseEvent>[];
}): DoseEventsFake {
  const events: FakeDoseEvent[] = (params.events ?? []).map((event, index) => ({
    id: event.id ?? `d-${index + 1}`,
    person_id: event.person_id ?? "p-1",
    regimen_id: event.regimen_id ?? (params.regimen.id as string),
    scheduled_at: event.scheduled_at ?? "2026-06-15T08:00:00.000Z",
    actual_at: event.actual_at ?? event.scheduled_at ?? "2026-06-15T08:00:00.000Z",
    taken_at: event.taken_at ?? null,
    status: event.status ?? "scheduled",
    planned_intake: event.planned_intake ?? { intake: { amount: 1, unit: "pill" }, active: [] },
    note: event.note ?? null,
    deleted_at: event.deleted_at ?? null,
    created_at: event.created_at ?? `2026-06-01T00:00:0${index}.000Z`,
  }));

  const inventory: FakeInventoryTransaction[] = [];
  let inserted = events.length;

  const failures: { med_dose_events?: string; rpc?: string } = {};
  let loseResponse: string | null = null;

  function takeFailure(table: "med_dose_events" | "rpc"): string | null {
    const message = failures[table] ?? null;
    delete failures[table];
    return message;
  }

  function builderFor(table: string) {
    const filters: Array<[string, string, unknown]> = [];
    let operation: "select" | "insert" | "update" | "delete" = "select";
    let payload: Record<string, unknown> | null = null;

    function matching(): FakeDoseEvent[] {
      const rows = table === "med_dose_events" ? events : [];
      return rows.filter((row) =>
        filters.every(([op, column, value]) => {
          const cell = (row as unknown as Record<string, unknown>)[column];
          switch (op) {
            case "eq":
              return cell === value;
            case "is":
              return cell === value;
            case "gte":
              return String(cell) >= String(value);
            case "lt":
              return String(cell) < String(value);
            case "lte":
              return String(cell) <= String(value);
            case "or":
              // The one shape this codebase builds:
              // `and(col.gte.X,col.lt.Y),and(other.gte.X,other.lt.Y)`.
              return String(value)
                .split(/\),(?=and\()/)
                .map((group) => group.replace(/^and\(/, "").replace(/\)$/, ""))
                .some((group) =>
                  group.split(",").every((condition) => {
                    const [conditionColumn, conditionOp, ...rest] = condition.split(".");
                    const target = rest.join(".");
                    const conditionCell = (row as unknown as Record<string, unknown>)[
                      conditionColumn
                    ];
                    if (conditionCell == null) return false;
                    return conditionOp === "gte"
                      ? String(conditionCell) >= target
                      : conditionOp === "lt"
                        ? String(conditionCell) < target
                        : (() => {
                            throw new Error(
                              `dose-events-fake: unsupported or-condition "${conditionOp}"`,
                            );
                          })();
                  }),
                );
            default:
              throw new Error(`dose-events-fake: unsupported filter "${op}"`);
          }
        }),
      );
    }

    function settle(many = false): { data: unknown; error: { message: string } | null } {
      if (table === "med_regimens") {
        const id = filters.find(([op, column]) => op === "eq" && column === "id")?.[2];
        return { data: params.regimen.id === id ? params.regimen : null, error: null };
      }

      const failure = takeFailure("med_dose_events");
      if (failure) {
        return { data: null, error: { message: failure } };
      }

      if (operation === "insert") {
        const row: FakeDoseEvent = {
          id: `d-${++inserted}`,
          person_id: (payload?.person_id as string) ?? "p-1",
          regimen_id: payload?.regimen_id as string,
          scheduled_at: payload?.scheduled_at as string,
          actual_at: (payload?.actual_at as string) ?? null,
          taken_at: null,
          status: (payload?.status as string) ?? "scheduled",
          planned_intake: payload?.planned_intake ?? null,
          note: null,
          deleted_at: null,
          created_at: "2026-06-15T09:00:00.000Z",
        };

        // The real partial unique index: unresolved rows only, and blind to
        // `deleted_at`.
        if (
          UNRESOLVED.has(row.status) &&
          events.some(
            (existing) => UNRESOLVED.has(existing.status) && minuteKey(existing) === minuteKey(row),
          )
        ) {
          return {
            data: null,
            error: {
              message:
                'duplicate key value violates unique constraint "idx_med_dose_events_regimen_scheduled_minute"',
            },
          };
        }

        events.push(row);
        return { data: row, error: null };
      }

      if (operation === "update") {
        for (const row of matching()) {
          Object.assign(row, payload);
        }
        return { data: null, error: null };
      }

      if (operation === "delete") {
        for (const row of matching()) {
          events.splice(events.indexOf(row), 1);
          // ON DELETE SET NULL, exactly as the FK declares.
          for (const transaction of inventory) {
            if (transaction.event_id === row.id) {
              transaction.event_id = null;
            }
          }
        }
        return { data: null, error: null };
      }

      const rows = [...matching()].sort((a, b) => a.created_at.localeCompare(b.created_at));
      // A select awaited directly reads rows; `single`/`maybeSingle` reads one,
      // as PostgREST does.
      return { data: many ? rows : (rows[0] ?? null), error: null };
    }

    const filter = (op: string) => (column: string, value: unknown) => {
      filters.push([op, column, value]);
      return builder;
    };

    const builder: Record<string, unknown> = {
      select: () => builder,
      insert: (values: Record<string, unknown>) => {
        operation = "insert";
        payload = values;
        return builder;
      },
      update: (values: Record<string, unknown>) => {
        operation = "update";
        payload = values;
        return builder;
      },
      delete: () => {
        operation = "delete";
        return builder;
      },
      eq: filter("eq"),
      is: filter("is"),
      or: (expression: string) => {
        filters.push(["or", "", expression]);
        return builder;
      },
      gte: filter("gte"),
      lt: filter("lt"),
      lte: filter("lte"),
      order: () => builder,
      limit: () => builder,
      single: async () => settle(),
      maybeSingle: async () => settle(),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve(settle(true))),
    };

    return builder;
  }

  /** `mark_dose_taken` / `mark_dose_skipped`, per `supabase/db/functions`. */
  const rpc = vi.fn(async (name: string, args: { p_dose_event_id: string; p_note?: string }) => {
    const failure = takeFailure("rpc");
    if (failure) {
      return { data: null, error: { message: failure } };
    }

    const accepts =
      name === "mark_dose_taken"
        ? ["scheduled", "sent", "snoozed", "skipped"]
        : ["scheduled", "sent", "snoozed", "taken"];

    const row = events.find((event) => event.id === args.p_dose_event_id);

    // `IF NOT FOUND THEN RETURN` -- a silent no-op, not an error.
    if (row && accepts.includes(row.status)) {
      const intake = (row.planned_intake as { intake?: { amount?: number; unit?: string } } | null)
        ?.intake;
      const amount = intake?.amount ?? 1;
      const unit = intake?.unit ?? "pill";

      if (name === "mark_dose_taken") {
        inventory.push({
          regimen_id: row.regimen_id,
          event_id: row.id,
          type: "decrement",
          amount,
          unit,
        });
        row.status = "taken";
      } else {
        if (row.status === "taken") {
          inventory.push({
            regimen_id: row.regimen_id,
            event_id: row.id,
            type: "correction",
            amount,
            unit,
          });
        }
        row.status = "skipped";
      }
      row.taken_at = row.actual_at;
      row.note = args.p_note?.trim() || null;
    }

    if (loseResponse) {
      const message = loseResponse;
      loseResponse = null;
      return { data: null, error: { message } };
    }

    return { data: null, error: null };
  });

  const client = {
    from: vi.fn((table: string) => builderFor(table)),
    rpc,
  } as unknown as SupabaseClient<Database>;

  return {
    client,
    events,
    inventory,
    rpc,
    failNext: (table, message) => {
      failures[table] = message;
    },
    loseRpcResponse: (message) => {
      loseResponse = message;
    },
  };
}
