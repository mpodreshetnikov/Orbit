import { assertEquals } from "std/assert/assert-equals";

export interface FetchCall {
  input: RequestInfo | URL;
  init?: RequestInit;
}

type FetchMatcher = (input: RequestInfo | URL, init?: RequestInit) => boolean;

type FetchResponder = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Response | Promise<Response>;

interface FetchExpectation {
  label: string;
  matcher: FetchMatcher;
  responder: FetchResponder;
}

interface UnorderedFetchExpectation extends FetchExpectation {
  remaining: number;
}

/**
 * Queue-based fetch stub for deterministic unit tests.
 */
export class FetchStub {
  private readonly originalFetch = globalThis.fetch;
  private readonly expectations: FetchExpectation[] = [];
  private readonly unorderedExpectations: UnorderedFetchExpectation[] = [];
  private readonly callLog: FetchCall[] = [];
  private installed = false;

  public install(): void {
    if (this.installed) return;
    this.installed = true;

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      this.callLog.push({ input, init });

      if (this.expectations.length > 0) {
        const next = this.expectations.shift()!;
        if (!next.matcher(input, init)) {
          throw new Error(`Fetch expectation mismatch for "${next.label}": ${toUrlString(input)}`);
        }
        return await next.responder(input, init);
      }

      const unorderedMatch = this.unorderedExpectations.find((entry) => entry.matcher(input, init));
      if (!unorderedMatch) {
        throw new Error(`Unexpected fetch call with no expectation: ${toUrlString(input)}`);
      }

      unorderedMatch.remaining -= 1;
      if (unorderedMatch.remaining <= 0) {
        const index = this.unorderedExpectations.indexOf(unorderedMatch);
        if (index >= 0) this.unorderedExpectations.splice(index, 1);
      }

      return await unorderedMatch.responder(input, init);
    }) as typeof fetch;
  }

  public restore(): void {
    if (!this.installed) return;
    globalThis.fetch = this.originalFetch;
    this.installed = false;
    this.expectations.length = 0;
    this.unorderedExpectations.length = 0;
    this.callLog.length = 0;
  }

  public calls(): FetchCall[] {
    return [...this.callLog];
  }

  public expect(label: string, matcher: FetchMatcher, responder: FetchResponder): void {
    this.expectations.push({ label, matcher, responder });
  }

  public expectUnordered(
    label: string,
    matcher: FetchMatcher,
    responder: FetchResponder,
    times = 1,
  ): void {
    this.unorderedExpectations.push({
      label,
      matcher,
      responder,
      remaining: Math.max(1, times),
    });
  }

  public expectUrl(label: string, expectedUrl: string | RegExp, responder: FetchResponder): void {
    this.expect(
      label,
      (input) => {
        const actual = toUrlString(input);
        if (typeof expectedUrl === "string") return actual === expectedUrl;
        return expectedUrl.test(actual);
      },
      responder,
    );
  }

  public expectUrlUnordered(
    label: string,
    expectedUrl: string | RegExp,
    responder: FetchResponder,
    times = 1,
  ): void {
    this.expectUnordered(
      label,
      (input) => {
        const actual = toUrlString(input);
        if (typeof expectedUrl === "string") return actual === expectedUrl;
        return expectedUrl.test(actual);
      },
      responder,
      times,
    );
  }

  public expectJson(
    label: string,
    expectedUrl: string | RegExp,
    body: unknown,
    init: { status?: number; headers?: HeadersInit } = {},
  ): void {
    this.expectUrl(
      label,
      expectedUrl,
      () =>
        new Response(JSON.stringify(body), {
          status: init.status ?? 200,
          headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
        }),
    );
  }

  public expectJsonUnordered(
    label: string,
    expectedUrl: string | RegExp,
    body: unknown,
    init: { status?: number; headers?: HeadersInit } = {},
    times = 1,
  ): void {
    this.expectUrlUnordered(
      label,
      expectedUrl,
      () =>
        new Response(JSON.stringify(body), {
          status: init.status ?? 200,
          headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
        }),
      times,
    );
  }

  public expectText(
    label: string,
    expectedUrl: string | RegExp,
    text: string,
    init: { status?: number; headers?: HeadersInit } = {},
  ): void {
    this.expectUrl(
      label,
      expectedUrl,
      () =>
        new Response(text, {
          status: init.status ?? 200,
          headers: init.headers,
        }),
    );
  }

  public expectTextUnordered(
    label: string,
    expectedUrl: string | RegExp,
    text: string,
    init: { status?: number; headers?: HeadersInit } = {},
    times = 1,
  ): void {
    this.expectUrlUnordered(
      label,
      expectedUrl,
      () =>
        new Response(text, {
          status: init.status ?? 200,
          headers: init.headers,
        }),
      times,
    );
  }

  public assertDone(): void {
    const unorderedPending = this.unorderedExpectations.flatMap((entry) =>
      Array.from({ length: entry.remaining }, () => entry.label),
    );
    assertEquals(
      [...this.expectations.map((entry) => entry.label), ...unorderedPending].length,
      0,
      `Expected all queued fetch expectations to be consumed, pending: ${[
        ...this.expectations.map((entry) => entry.label),
        ...unorderedPending,
      ].join(", ")}`,
    );
  }
}

export function createFetchStub(): FetchStub {
  return new FetchStub();
}

export function toUrlString(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}
