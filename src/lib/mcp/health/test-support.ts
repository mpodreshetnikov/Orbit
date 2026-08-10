import { vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * Shared PostgREST stub for the health data-layer tests.
 *
 * The data layer builds queries by chaining, then awaits either the builder
 * itself or a `single`/`maybeSingle` terminal. This records every link in the
 * chain -- so a test can assert the query that was built -- and resolves
 * terminals from a per-table FIFO queue.
 *
 * Kept in a non-`.test.ts` file so all the health suites can import it; vitest
 * only treats `*.test.ts` as a suite, so this is never collected as one.
 */

export type StubResult = { data?: unknown; error?: { message: string } | null };

export interface RecordedCall {
  table: string;
  method: string;
  args: unknown[];
}

export interface SupabaseStub {
  client: SupabaseClient<Database>;
  calls: RecordedCall[];
  /** Every argument list passed to `method` on `table`, in call order. */
  argsFor: (table: string, method: string) => unknown[][];
  /** Convenience for the common single-table case. */
  args: (method: string) => unknown[][];
  rpc: ReturnType<typeof vi.fn>;
}

export function createSupabaseStub(
  queues: Record<string, StubResult[]>,
  rpcResults: Record<string, StubResult> = {},
): SupabaseStub {
  const calls: RecordedCall[] = [];

  function builderFor(table: string) {
    const next = (): StubResult => queues[table]?.shift() ?? { data: null, error: null };

    const record =
      (method: string) =>
      (...args: unknown[]) => {
        calls.push({ table, method, args });
        return builder;
      };

    const settle =
      (method: string) =>
      async (...args: unknown[]) => {
        calls.push({ table, method, args });
        const r = next();
        return { data: r.data ?? null, error: r.error ?? null };
      };

    const builder: Record<string, unknown> = {
      select: record("select"),
      insert: record("insert"),
      update: record("update"),
      upsert: record("upsert"),
      delete: record("delete"),
      eq: record("eq"),
      neq: record("neq"),
      is: record("is"),
      gt: record("gt"),
      gte: record("gte"),
      lt: record("lt"),
      lte: record("lte"),
      in: record("in"),
      or: record("or"),
      order: record("order"),
      limit: record("limit"),
      range: record("range"),
      single: settle("single"),
      maybeSingle: settle("maybeSingle"),
      then: (resolve: (value: unknown) => unknown) => {
        const r = next();
        return Promise.resolve(resolve({ data: r.data ?? null, error: r.error ?? null }));
      },
    };

    return builder;
  }

  const rpc = vi.fn(async (name: string, params: unknown) => {
    calls.push({ table: `rpc:${name}`, method: "rpc", args: [params] });
    const r = rpcResults[name] ?? { data: [] };
    return { data: r.data ?? null, error: r.error ?? null };
  });

  const client = {
    from: vi.fn((table: string) => builderFor(table)),
    rpc,
  } as unknown as SupabaseClient<Database>;

  const argsFor = (table: string, method: string) =>
    calls.filter((c) => c.table === table && c.method === method).map((c) => c.args);

  const args = (method: string) => calls.filter((c) => c.method === method).map((c) => c.args);

  return { client, calls, argsFor, args, rpc };
}
