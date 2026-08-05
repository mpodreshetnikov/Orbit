/**
 * Recorded OpenRouter responses, so the default eval run is free, offline and deterministic.
 *
 * The stage client only ever reads `response.ok`, `response.status`,
 * `response.headers.get("retry-after")` and `response.json()`, so a plain `Response` built from a
 * stored payload is a complete substitute for a live call.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

export type CassetteMode = "replay" | "record" | "live";

export interface CassetteEntry {
  key: string;
  /** Kept purely so a human can tell which stage a file belongs to when reading the directory. */
  stage: string;
  model: string;
  response: unknown;
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
 * Key on the full request body. Anything that changes the prompt — a catalogue edit, a reworded
 * instruction, a different patient context — must invalidate the recording, because the reply is
 * only valid for the question that produced it.
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
    entries.set(entry.key, entry);
  }
  return entries;
}

export interface CassetteFetch {
  fetchFn: typeof fetch;
  /** Called after a case completes; writes any newly recorded entries. */
  flush: () => Promise<void>;
  misses: () => string[];
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

  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
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
      return new Response(JSON.stringify(hit.response), { status: 200 });
    }

    const response = await liveFetch(url as never, init);
    if (mode === "record" && response.ok) {
      const payload = await response.clone().json();
      recorded.set(key, { key, stage, model: String(body.model ?? ""), response: payload });
    }
    return response;
  }) as unknown as typeof fetch;

  return {
    fetchFn,
    misses: () => misses,
    flush: async () => {
      if (recorded.size === 0) return;
      await mkdir(dir, { recursive: true });
      for (const entry of recorded.values()) {
        await writeFile(
          path.join(dir, `${entry.stage}-${entry.key}.json`),
          `${JSON.stringify(entry, null, 2)}\n`,
          "utf8",
        );
      }
    },
  };
}
