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
 * refetch after a tap sees the new state; any other RPC is answered by `rpcHandlers`. Every call is
 * recorded in `calls`.
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
  calls.rpc = [];
  for (const name of Object.keys(rpcHandlers)) {
    delete rpcHandlers[name];
  }
}

/** Make every query on `table` (or every RPC named so) fail with a PostgREST-shaped error. */
export function fail(name: string) {
  db.failing.add(name);
}

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
  return String(a) < String(b) ? -1 : 1;
}

class Query {
  private filters: Filter[] = [];
  private orders: { column: string; ascending: boolean }[] = [];
  private single = false;

  constructor(private readonly table: string) {}

  select() {
    return this;
  }
  eq(column: string, value: unknown) {
    this.filters.push((row) => row[column] === value);
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
  maybeSingle() {
    this.single = true;
    return this;
  }

  private run(): Result {
    if (db.failing.has(this.table)) {
      return { data: null, error: { message: `${this.table} is unavailable` } };
    }
    const rows = (db.tables[this.table] ?? []).filter((row) => this.filters.every((f) => f(row)));
    const sorted = [...rows].sort((a, b) => {
      for (const { column, ascending } of this.orders) {
        const order = compare(a[column], b[column]);
        if (order !== 0) return ascending ? order : -order;
      }
      return 0;
    });
    const copy = structuredClone(sorted);
    return { data: this.single ? (copy[0] ?? null) : copy, error: null };
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
