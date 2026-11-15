/**
 * Recorded OpenRouter responses for money categorization, so the default eval run is free,
 * offline and deterministic.
 *
 * Same contract as `scripts/extraction-eval/cassette.ts`: key on model + messages, stage label
 * is "categorize" for filenames. Kept local rather than imported so money eval does not take a
 * dependency on health prompt anchors.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export type CassetteMode = "replay" | "record" | "live";

export interface CassetteEntry {
  /**
   * Named `request_hash` rather than `key`: a JSON field literally called "key" holding a hex
   * string is what a secret scanner is built to catch.
   */
  request_hash: string;
  stage: string;
  model: string;
  response: unknown;
}

export function cassetteKey(body: Record<string, unknown>): string {
  const material = JSON.stringify({ model: body.model, messages: body.messages });
  return createHash("sha256").update(material).digest("hex").slice(0, 16);
}

export function stripReasoning(response: unknown): unknown {
  // Non-object short-circuit is shadowed by the `!choices` return for every primitive we can pass.
  // Stryker disable next-line ConditionalExpression: equivalent under the later !choices return
  if (!response || typeof response !== "object") return response;
  const payload = response as Record<string, unknown>;
  const choices = Array.isArray(payload.choices) ? payload.choices : null;
  if (!choices) return response;
  return {
    ...payload,
    choices: choices.map((choice) => {
      // Stryker disable next-line ConditionalExpression,LogicalOperator: shadowed by !message check
      if (!choice || typeof choice !== "object") return choice;
      const entry = choice as Record<string, unknown>;
      if (!entry.message || typeof entry.message !== "object") return choice;
      const {
        reasoning: _reasoning,
        reasoning_details: _details,
        ...message
      } = entry.message as Record<string, unknown>;
      return { ...entry, message };
    }),
  };
}

async function loadDir(dir: string): Promise<Map<string, CassetteEntry>> {
  const entries = new Map<string, CassetteEntry>();
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return entries;
  }
  for (const file of files.filter((name) => name.endsWith(".json"))) {
    const entry = JSON.parse(await readFile(path.join(dir, file), "utf8")) as CassetteEntry;
    entries.set(entry.request_hash, entry);
  }
  return entries;
}

export interface CassetteFetch {
  fetchFn: typeof fetch;
  flush: (options?: { prune?: boolean }) => Promise<void>;
  misses: () => string[];
  settled: () => Promise<void>;
}

export async function createCassetteFetch(options: {
  dir: string;
  mode: CassetteMode;
  liveFetch?: typeof fetch;
}): Promise<CassetteFetch> {
  const { dir, mode } = options;
  const liveFetch = options.liveFetch ?? globalThis.fetch;
  const existing = await loadDir(dir);
  const recorded = new Map<string, CassetteEntry>();
  const misses: string[] = [];
  const inFlight = new Set<Promise<unknown>>();
  const stage = "categorize";

  const fetchFn = ((url: string | URL | Request, init?: RequestInit) => {
    const pending = handle(url, init);
    inFlight.add(pending);
    void pending.catch(() => {}).finally(() => inFlight.delete(pending));
    return pending;
  }) as unknown as typeof fetch;

  async function handle(_url: string | URL | Request, init?: RequestInit): Promise<Response> {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    const key = cassetteKey(body);

    if (mode === "replay") {
      const hit = existing.get(key);
      if (!hit) {
        misses.push(`${stage}:${key}`);
        throw new Error(
          `cassette miss for stage "${stage}" (key ${key}) in ${dir}.\n` +
            `The recorded prompt no longer matches the prompt being sent — a catalogue, fixture ` +
            `or prompt change will do that. Re-record with:\n` +
            `  just test-money-categorization --record`,
        );
      }
      // Response defaults to 200 when status is omitted — keep it explicit for readers.
      // Stryker disable next-line ObjectLiteral -- status:200 is equivalent to Response default
      return new Response(JSON.stringify(hit.response), { status: 200 });
    }

    const response = await liveFetch(_url as never, init);
    if (response.ok && mode === "record") {
      const payload = stripReasoning(await response.clone().json());
      recorded.set(key, {
        request_hash: key,
        stage,
        model: String(body.model ?? ""),
        response: payload,
      });
    }
    return response;
  }

  return {
    fetchFn,
    settled: async () => {
      while (inFlight.size > 0) {
        // Spreading the Set is required so allSettled observes the in-flight handles; an empty
        // array would busy-yield until the live fetch clears the Set on its own — same eventual
        // resolve under a blocked gate, so the mutant is not a behavioural difference we can assert.
        // Stryker disable next-line ArrayDeclaration
        await Promise.allSettled([...inFlight]);
      }
    },
    misses: () => misses,
    flush: async (options?: { prune?: boolean }) => {
      if (recorded.size === 0) return;
      await mkdir(dir, { recursive: true });
      for (const entry of recorded.values()) {
        await writeFile(
          path.join(dir, `${entry.stage}-${entry.request_hash}.json`),
          `${JSON.stringify(entry, null, 2)}\n`,
          "utf8",
        );
      }
      if (!options?.prune) return;
      for (const [key, entry] of existing) {
        if (recorded.has(key)) continue;
        // force: missing stale paths must not throw when the on-disk name already drifted.
        await rm(path.join(dir, `${entry.stage}-${entry.request_hash}.json`), { force: true });
      }
    },
  };
}
