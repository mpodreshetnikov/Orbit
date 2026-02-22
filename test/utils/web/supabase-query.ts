import { vi } from "vitest";

export interface MockSupabaseError {
  code?: string;
  message: string;
}

export interface MockSupabaseResult<T = unknown> {
  data: T;
  error: MockSupabaseError | null;
}

type AnyFn = (...args: unknown[]) => unknown;

const CHAIN_METHODS = [
  "select",
  "eq",
  "is",
  "order",
  "in",
  "gte",
  "lt",
  "or",
  "limit",
  "insert",
  "update",
  "delete",
] as const;

export function createQueryBuilder<T = unknown>(
  result: MockSupabaseResult<T>,
): Record<string, ReturnType<typeof vi.fn>> {
  const builder: Record<string, ReturnType<typeof vi.fn> | AnyFn> = {};

  CHAIN_METHODS.forEach((method) => {
    builder[method] = vi.fn(() => builder);
  });

  builder.single = vi.fn(async () => result);
  builder.maybeSingle = vi.fn(async () => result);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (builder as any).then = (onFulfilled?: AnyFn, onRejected?: AnyFn) =>
    Promise.resolve(result).then(onFulfilled, onRejected);

  return builder as Record<string, ReturnType<typeof vi.fn>>;
}
