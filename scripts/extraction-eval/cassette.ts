/**
 * Recorded OpenRouter responses, so the default eval run is free, offline and deterministic.
 *
 * The stage client only ever reads `response.ok`, `response.status`,
 * `response.headers.get("retry-after")` and `response.json()`, so a plain `Response` built from a
 * stored payload is a complete substitute for a live call.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export type CassetteMode = "replay" | "record" | "live";

export interface CassetteEntry {
  /**
   * Named `request_hash` rather than `key`: it is a digest of the request, and a JSON field
   * literally called "key" holding a hex string is what a secret scanner is built to catch —
   * gitleaks flags it as `generic-api-key`. Allowlisting the cassette directory would be the
   * wrong way out, since recorded API traffic is precisely where a real credential could hide.
   */
  request_hash: string;
  /** Kept purely so a human can tell which stage a file belongs to when reading the directory. */
  stage: string;
  model: string;
  response: unknown;
}

/**
 * What one stage spent across a case, split out of the total the eval otherwise reports.
 *
 * The per-stage split is the thing a mixed model configuration is decided on. The stage overrides
 * in `health-structure/deps.ts` let classify, extract and reconcile each run a different model, but
 * a single total per case cannot say what moving one of them would save — a stage that is 5% of the
 * bill and a stage that is 60% of it look identical in one number.
 *
 * Accounted here, in the cassette's fetch wrapper, rather than in the stage orchestrator: this
 * layer already sees every request, already infers the stage from the prompt, and is the eval's own
 * code. Threading usage back out of `stages/index.ts` would put this task's change inside the
 * directory two other in-progress tasks are editing, for no gain in what gets measured.
 */
export interface StageSpend {
  stage: string;
  /** Requests that returned a usable answer. A retried 429 counts once per successful attempt. */
  calls: number;
  promptTokens: number | null;
  completionTokens: number | null;
  /** Null rather than zero when the router priced nothing, matching `CaseDiagnostics.costUsd`. */
  costUsd: number | null;
}

/**
 * Add a response's usage into a stage's running total.
 *
 * Nulls are contagious in one direction only: a stage that saw one unpriced answer cannot report a
 * trustworthy total, so the total goes null rather than silently reporting the priced subset as if
 * it were everything. That mirrors `sumUsage` in `_shared/llm-usage.ts` and the reasoning on
 * `CaseDiagnostics.costUsd`.
 */
function addUsage(into: StageSpend, usage: Record<string, unknown> | null): void {
  into.calls += 1;
  const read = (key: string): number | null => {
    const value = usage?.[key];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  };
  const merge = (current: number | null, next: number | null): number | null =>
    current === null || next === null ? null : current + next;
  into.promptTokens = merge(into.promptTokens, read("prompt_tokens"));
  into.completionTokens = merge(into.completionTokens, read("completion_tokens"));
  into.costUsd = merge(into.costUsd, read("cost"));
}

function usageOf(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== "object") return null;
  const usage = (payload as Record<string, unknown>).usage;
  return usage && typeof usage === "object" ? (usage as Record<string, unknown>) : null;
}

/**
 * Stage names are inferred from the prompt because the request itself carries no stage marker.
 * These anchors are copied from the stage instruction strings; if a prompt is reworded the
 * cassette is simply labelled "unknown", which affects the filename and nothing else.
 */
function inferStage(body: Record<string, unknown>): string {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const prompt = messages
    .map((message) => {
      const content = (message as Record<string, unknown>)?.content;
      return typeof content === "string" ? content : "";
    })
    .join("\n");
  if (prompt.includes("describe it as a whole")) return "classify";
  if (prompt.includes("Extract clinical entities")) return "extract";
  if (prompt.includes("existing record")) return "reconcile";
  return "unknown";
}

/**
 * Drop the reasoning trace from a recorded response.
 *
 * Nothing reads it: the stage client takes `message.content`, `finish_reason` and `usage`, and
 * that is the whole contract this file exists to satisfy. Keeping it is not merely wasteful.
 * `reasoning_details` carries the provider's *encrypted* reasoning blob — kilobytes of opaque
 * base64 that secret scanners flag as a leaked credential, correctly by their own lights, since
 * nothing in the string says otherwise. A recording is a stand-in for one answer, not an archive
 * of how the model got there.
 */
export function stripReasoning(response: unknown): unknown {
  if (!response || typeof response !== "object") return response;
  const payload = response as Record<string, unknown>;
  const choices = Array.isArray(payload.choices) ? payload.choices : null;
  if (!choices) return response;
  return {
    ...payload,
    choices: choices.map((choice) => {
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

/**
 * Key on the model and the messages. Anything that changes the prompt — a catalogue edit, a
 * reworded instruction, a different patient context — invalidates the recording, because the reply
 * is only valid for the question that produced it.
 *
 * Deliberately *not* the whole request body: transport knobs (`max_tokens`, `provider`) do not
 * change the answer, and keying on them would churn every recording whenever one was retuned.
 *
 * The sharp edge is `response_format`, which carries the stage's JSON schema and is excluded here.
 * A schema change that leaves the prompt text untouched will replay stale cassettes that cannot
 * contain the new field, and the corpus will look fine while measuring nothing. In practice a
 * schema change comes with instructions describing the new field, which does move the key — but if
 * you ever add a field without touching the prompt, re-record explicitly rather than trusting this.
 */
export function cassetteKey(body: Record<string, unknown>): string {
  const material = JSON.stringify({ model: body.model, messages: body.messages });
  return createHash("sha256").update(material).digest("hex").slice(0, 16);
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
  /**
   * Called after a case completes; writes any newly recorded entries.
   *
   * Pass `prune` when the case ran to completion, which makes the written set authoritative and
   * lets stale recordings be deleted. Never pass it after a failure: a case that died at reconcile
   * recorded only classify and extract, and pruning on that would throw away a good reconcile
   * cassette and turn one bad run into a corpus that no longer replays.
   */
  flush: (options?: { prune?: boolean }) => Promise<void>;
  misses: () => string[];
  /**
   * Resolve once every request this cassette has started has finished recording its usage.
   *
   * `runStagedParse` runs classify and extract under `Promise.all`, which rejects the moment either
   * one does — without cancelling or awaiting its sibling. A failed case therefore reaches its
   * handler while the other stage's request is still in flight, and reading `stageSpend()` there
   * would miss spend the account was still charged for. That is precisely the case the per-stage
   * table exists to account for, so the snapshot waits for the stragglers first.
   */
  settled: () => Promise<void>;
  /**
   * What each stage spent, in the order the stages first ran.
   *
   * On a replay this is the price of the calls that *recorded* the cassettes, exactly as the
   * case total is — worth reporting as what those answers cost to obtain, and emphatically not
   * what the replay cost. `renderMarkdown` carries that caveat for both.
   */
  stageSpend: () => StageSpend[];
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
  // Insertion-ordered, so the report lists stages in the order the pipeline ran them rather than
  // alphabetically — classify, extract, reconcile reads as the pipeline; classify, extract,
  // reconcile happens to as well, but a renamed stage should not silently reorder the table.
  const spend = new Map<string, StageSpend>();
  // Every request started, settled or not. Awaited by `settled()` before spend is read.
  const inFlight = new Set<Promise<unknown>>();

  function record(stage: string, payload: unknown): void {
    let entry = spend.get(stage);
    if (!entry) {
      entry = { stage, calls: 0, promptTokens: 0, completionTokens: 0, costUsd: 0 };
      spend.set(stage, entry);
    }
    addUsage(entry, usageOf(payload));
  }

  const fetchFn = ((url: string | URL | Request, init?: RequestInit) => {
    const pending = handle(url, init);
    inFlight.add(pending);
    // Settled rather than resolved: a rejected request still has to stop being in flight, and its
    // rejection is the caller's to handle, not this bookkeeping's.
    void pending.catch(() => {}).finally(() => inFlight.delete(pending));
    return pending;
  }) as unknown as typeof fetch;

  async function handle(url: string | URL | Request, init?: RequestInit): Promise<Response> {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    const key = cassetteKey(body);
    const stage = inferStage(body);

    if (mode === "replay") {
      const hit = existing.get(key);
      if (!hit) {
        misses.push(`${stage}:${key}`);
        throw new Error(
          `cassette miss for stage "${stage}" (key ${key}) in ${dir}.\n` +
            `The recorded prompt no longer matches the prompt being sent — a catalogue, fixture ` +
            `or prompt change will do that. Re-record with:\n` +
            `  just test-extraction --record --live`,
        );
      }
      record(stage, hit.response);
      return new Response(JSON.stringify(hit.response), { status: 200 });
    }

    const response = await liveFetch(url as never, init);
    // Only a successful answer carries usage. A 429 or a 5xx that the stage client retries has no
    // `usage` block to account, and counting it as a call would inflate the stage's call count with
    // attempts that bought nothing.
    if (response.ok) {
      // Cloned because the stage client reads the body itself; consuming it here would leave it
      // with an already-used stream. `record` mode clones for the same reason.
      const payload = stripReasoning(await response.clone().json());
      record(stage, payload);
      if (mode === "record") {
        recorded.set(key, {
          request_hash: key,
          stage,
          model: String(body.model ?? ""),
          response: payload,
        });
      }
    }
    return response;
  }

  return {
    fetchFn,
    settled: async () => {
      // A stage can start a retry as an earlier request settles, so drain until the set is empty
      // rather than awaiting one snapshot of it.
      while (inFlight.size > 0) {
        await Promise.allSettled([...inFlight]);
      }
    },
    misses: () => misses,
    stageSpend: () => [...spend.values()].map((entry) => ({ ...entry })),
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
      // A prompt or fixture edit changes the key, so re-recording adds a file rather than
      // replacing one and the old recording is left behind unreachable. Nothing reads it and
      // nothing reports it, so the directory silently fills with answers to questions no longer
      // being asked. A completed record run knows every key its case needs, so anything else here
      // is dead.
      if (!options?.prune) return;
      for (const [key, entry] of existing) {
        if (recorded.has(key)) continue;
        await rm(path.join(dir, `${entry.stage}-${entry.request_hash}.json`), { force: true });
      }
    },
  };
}
