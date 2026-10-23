import type { Session } from "@supabase/supabase-js";

/**
 * An in-memory stand-in for the Supabase client, for screen tests.
 *
 * Tests replace `@/lib/supabase` with this module (`jest.mock("@/lib/supabase", () =>
 * require("../../test/fake-supabase"))`) and seed rows with `seed`. Queries run the real query
 * modules against those rows: `eq`, `is`, `in`, `gte`, `lt` and `order` filter and sort as PostgREST
 * would for the simple cases the app uses, so a screen test also covers the query it depends on.
 * A joined column (`regimen:med_regimens(...)`) is not resolved; seed the row with the nested object
 * already in place. The three dose RPCs change the seeded dose as the database functions do, so a
 * refetch after a tap sees the new state; any other RPC, and any edge function, is answered by
 * `rpcHandlers`. Every call is recorded in `calls`.
 *
 * Writes work the same way: `insert`, `update`, `upsert` and `delete` change the seeded rows, after
 * the filters chained to them, and a `select()` after one returns what was written. A new row gets an
 * `id` when it has none.
 */

type Row = Record<string, unknown>;
type AuthError = { message: string } | null;
type Result = { data: unknown; error: AuthError };
type Filter = (row: Row) => boolean;

export const db: { tables: Record<string, Row[]>; failing: Set<string> } = {
  tables: {},
  failing: new Set(),
};
export const calls: { rpc: { name: string; args: unknown }[] } = { rpc: [] };
export const rpcHandlers: Record<string, (args: Record<string, unknown>) => unknown> = {};

function updateDose(args: Record<string, unknown>, changes: Row) {
  const row = (db.tables.med_dose_events ?? []).find((one) => one.id === args.p_dose_event_id);
  if (row) Object.assign(row, changes);
}

const doseFunctions: Record<string, (args: Record<string, unknown>) => void> = {
  mark_dose_taken: (args) => updateDose(args, { status: "taken", taken_at: args.p_taken_at }),
  mark_dose_skipped: (args) => updateDose(args, { status: "skipped", taken_at: null }),
  undo_dose_intake: (args) => updateDose(args, { status: "scheduled", taken_at: null }),
};
let session: Session | null = null;
const listeners = new Set<(event: string, session: Session | null) => void>();

/** Replace every table's rows and forget failures, recorded calls and RPC handlers. */
export function seed(tables: Record<string, Row[]>) {
  db.tables = structuredClone(tables);
  db.failing.clear();
  failingOnce.clear();
  calls.rpc = [];
  for (const name of Object.keys(rpcHandlers)) {
    delete rpcHandlers[name];
  }
}

/** Make every query on `table` (or every RPC named so) fail with a PostgREST-shaped error. */
export function fail(name: string) {
  db.failing.add(name);
}

/** Fail the next request to `name` only, so what follows it (a refetch after an error) succeeds. */
export function failOnce(name: string) {
  failingOnce.add(name);
}

const failingOnce = new Set<string>();

export function setSession(next: Session | null) {
  session = next;
  for (const listener of listeners) {
    listener(next ? "SIGNED_IN" : "SIGNED_OUT", next);
  }
}

export function fakeSession(userId = "user-1"): Session {
  return {
    access_token: "token",
    refresh_token: "refresh",
    expires_in: 3600,
    token_type: "bearer",
    user: { id: userId, app_metadata: {}, user_metadata: {}, aud: "authenticated", created_at: "" },
  } as Session;
}

function compare(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  // Numbers order as numbers, as Postgres orders them; the rest as text.
  if (typeof a === "number" && typeof b === "number") return a < b ? -1 : 1;
  return String(a) < String(b) ? -1 : 1;
}

type Write =
  | { kind: "insert"; rows: Row[] }
  | { kind: "update"; values: Row }
  | { kind: "upsert"; rows: Row[]; key: string }
  | { kind: "delete" };

let nextId = 1;

class Query {
  private filters: Filter[] = [];
  private orders: { column: string; ascending: boolean }[] = [];
  private one = false;
  private window: [number, number] | null = null;
  private write: Write | null = null;

  constructor(private readonly table: string) {}

  insert(values: Row | Row[]) {
    this.write = { kind: "insert", rows: Array.isArray(values) ? values : [values] };
    return this;
  }
  update(values: Row) {
    this.write = { kind: "update", values };
    return this;
  }
  upsert(values: Row | Row[], options: { onConflict?: string } = {}) {
    const rows = Array.isArray(values) ? values : [values];
    this.write = { kind: "upsert", rows, key: options.onConflict ?? "id" };
    return this;
  }
  delete() {
    this.write = { kind: "delete" };
    return this;
  }

  select() {
    return this;
  }
  /** A dotted column filters on an embedded row, as `.eq("medical_records.status", …)` does. */
  eq(column: string, value: unknown) {
    this.filters.push(
      (row) => column.split(".").reduce<unknown>((at, key) => (at as Row)?.[key], row) === value,
    );
    return this;
  }
  is(column: string, value: unknown) {
    this.filters.push((row) => (row[column] ?? null) === value);
    return this;
  }
  in(column: string, values: readonly unknown[]) {
    this.filters.push((row) => values.includes(row[column]));
    return this;
  }
  gte(column: string, value: unknown) {
    this.filters.push((row) => compare(row[column], value) >= 0);
    return this;
  }
  lt(column: string, value: unknown) {
    this.filters.push((row) => compare(row[column], value) < 0);
    return this;
  }
  order(column: string, options: { ascending?: boolean } = {}) {
    this.orders.push({ column, ascending: options.ascending ?? true });
    return this;
  }
  /** Rows `from` to `to`, both inclusive, as PostgREST pages them. */
  range(from: number, to: number) {
    this.window = [from, to];
    return this;
  }
  maybeSingle() {
    this.one = true;
    return this;
  }
  single() {
    return this.maybeSingle();
  }

  /** Apply the pending write and return the rows it touched. */
  private apply(write: Write): Row[] {
    const table = (db.tables[this.table] ??= []);
    if (write.kind === "insert") {
      const rows = write.rows.map((row) => ({ id: `new-${nextId++}`, ...structuredClone(row) }));
      table.push(...rows);
      return rows;
    }
    if (write.kind === "upsert") {
      return write.rows.map((row) => {
        const existing = table.find((one) => one[write.key] === row[write.key]);
        if (existing) return Object.assign(existing, structuredClone(row));
        const created = { id: `new-${nextId++}`, ...structuredClone(row) };
        table.push(created);
        return created;
      });
    }
    const matched = table.filter((row) => this.filters.every((f) => f(row)));
    if (write.kind === "update") {
      for (const row of matched) Object.assign(row, structuredClone(write.values));
    } else {
      db.tables[this.table] = table.filter((row) => !matched.includes(row));
    }
    return matched;
  }

  private run(): Result {
    if (failingOnce.delete(this.table) || db.failing.has(this.table)) {
      return { data: null, error: { message: `${this.table} is unavailable` } };
    }
    if (this.write) {
      const written = structuredClone(this.apply(this.write));
      return { data: this.one ? (written[0] ?? null) : written, error: null };
    }
    const rows = (db.tables[this.table] ?? []).filter((row) => this.filters.every((f) => f(row)));
    const sorted = [...rows].sort((a, b) => {
      for (const { column, ascending } of this.orders) {
        const order = compare(a[column], b[column]);
        if (order !== 0) return ascending ? order : -order;
      }
      return 0;
    });
    const copy = structuredClone(
      this.window ? sorted.slice(this.window[0], this.window[1] + 1) : sorted,
    );
    return { data: this.one ? (copy[0] ?? null) : copy, error: null };
  }

  /** Awaiting the builder runs the query, as awaiting Supabase's own builder does. */
  then<A = Result, B = never>(
    onFulfilled?: ((value: Result) => A | PromiseLike<A>) | null,
    onRejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): Promise<A | B> {
    return Promise.resolve(this.run()).then(onFulfilled, onRejected);
  }
}

export const supabase = {
  from: (table: string) => new Query(table),
  rpc: async (name: string, args: Record<string, unknown> = {}) => {
    calls.rpc.push({ name, args });
    if (db.failing.has(name)) {
      return { data: null, error: { message: `${name} failed` } };
    }
    doseFunctions[name]?.(args);
    return { data: rpcHandlers[name]?.(args) ?? null, error: null };
  },
  functions: {
    invoke: (name: string, options: { body?: Record<string, unknown> } = {}) =>
      supabase.rpc(name, options.body),
  },
  auth: {
    getSession: async () => ({ data: { session }, error: null }),
    onAuthStateChange: (listener: (event: string, session: Session | null) => void) => {
      listeners.add(listener);
      return { data: { subscription: { unsubscribe: () => listeners.delete(listener) } } };
    },
    signOut: async () => {
      setSession(null);
      return { error: null };
    },
    signInWithPassword: async () => {
      setSession(fakeSession());
      return { data: {}, error: null as AuthError };
    },
    signInWithOAuth: async () => ({
      data: { url: "https://example.com/auth" },
      error: null as AuthError,
    }),
    exchangeCodeForSession: async () => {
      setSession(fakeSession());
      return { error: null as AuthError };
    },
    startAutoRefresh: async () => {},
    stopAutoRefresh: async () => {},
  },
};
