import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { collectBoardCardsFromTexts } from "./adapter";
import type { BoardCard, TaskTextSource } from "./types";

/** ~15 min freshness target (Lead path b). */
export const WORK_BOARD_CACHE_TTL_MS_DEFAULT = 15 * 60 * 1000;

const DEFAULT_REPO = "mpodreshetnikov/orbit-tasks";
const TASK_PATH_RE = /^docs\/tasks\/T-[^/]+\.md$/i;

type CacheEntry = {
  expiresAtMs: number;
  cards: BoardCard[];
  generatedAt: string;
  source: "github" | "local-dir";
};

let cache: CacheEntry | null = null;

export function clearWorkBoardCache(): void {
  cache = null;
}

export function getWorkBoardGithubToken(env: NodeJS.ProcessEnv = process.env): string | null {
  const token = (env.ORBIT_TASKS_GITHUB_TOKEN || "").trim();
  return token || null;
}

function getRepo(env: NodeJS.ProcessEnv = process.env): string {
  return (env.ORBIT_TASKS_GITHUB_REPO || DEFAULT_REPO).trim() || DEFAULT_REPO;
}

function getCacheTtlMs(env: NodeJS.ProcessEnv = process.env): number {
  // Number() already ignores surrounding spaces; trim is equivalent for TTL parsing.
  // Stryker disable next-line MethodExpression: Number() accepts leading/trailing spaces the same way
  const raw = (env.ORBIT_WORK_BOARD_CACHE_TTL_MS || "").trim();
  if (!raw) {
    return WORK_BOARD_CACHE_TTL_MS_DEFAULT;
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    return WORK_BOARD_CACHE_TTL_MS_DEFAULT;
  }
  return n;
}

function getLocalTasksDir(env: NodeJS.ProcessEnv = process.env): string | null {
  const dir = (env.ORBIT_WORK_BOARD_TASKS_DIR || "").trim();
  return dir || null;
}

async function githubJson<T>(url: string, token: string, fetchImpl: typeof fetch): Promise<T> {
  const response = await fetchImpl(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "orbit-work-board",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok) {
    // Stryker disable next-line ArrowFunction: text() rejection falls back to empty diagnostic suffix
    const body = await response.text().catch(() => "");
    throw new Error(`GitHub ${response.status} for ${url}: ${body.slice(0, 200)}`);
  }
  return (await response.json()) as T;
}

function loadFromLocalDir(dir: string): TaskTextSource[] {
  const entries = readdirSync(dir);
  const out: TaskTextSource[] = [];
  for (const name of entries) {
    if (!name.startsWith("T-") || !name.endsWith(".md")) {
      continue;
    }
    const full = join(dir, name);
    if (!statSync(full).isFile()) {
      continue;
    }
    out.push({ path: `docs/tasks/${name}`, text: readFileSync(full, "utf8") });
  }
  return out;
}

export async function fetchOrbitTaskTexts(options?: {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}): Promise<TaskTextSource[]> {
  const env = options?.env ?? process.env;
  const fetchImpl = options?.fetchImpl ?? fetch;
  const localDir = getLocalTasksDir(env);
  if (localDir) {
    return loadFromLocalDir(localDir);
  }

  const token = getWorkBoardGithubToken(env);
  if (!token) {
    throw new Error(
      "ORBIT_TASKS_GITHUB_TOKEN is missing; cannot fetch private orbit-tasks (Lead: do not bypass).",
    );
  }

  const repo = getRepo(env);
  const tree = await githubJson<{
    tree: Array<{ path: string; type: string; sha: string }>;
  }>(`https://api.github.com/repos/${repo}/git/trees/main?recursive=1`, token, fetchImpl);

  const blobs = (tree.tree || []).filter(
    (entry) => entry.type === "blob" && TASK_PATH_RE.test(entry.path),
  );

  const texts: TaskTextSource[] = [];
  const concurrency = 8;
  // Batching is a politeness window; `i <= length` only adds an empty final batch (equivalent).
  // Stryker disable next-line EqualityOperator: an empty trailing batch does not change fetched texts
  for (let i = 0; i < blobs.length; i += concurrency) {
    // Stryker disable next-line MethodExpression: fetching the full blob list at once is equivalent to chunked Promise.all
    const batch = blobs.slice(i, i + concurrency);
    const parts = await Promise.all(
      batch.map(async (entry) => {
        const blob = await githubJson<{ content?: string; encoding?: string }>(
          `https://api.github.com/repos/${repo}/git/blobs/${entry.sha}`,
          token,
          fetchImpl,
        );
        if (blob.encoding !== "base64" || !blob.content) {
          throw new Error(`Unexpected blob encoding for ${entry.path}`);
        }
        const text = Buffer.from(blob.content.replace(/\n/g, ""), "base64").toString("utf8");
        return { path: entry.path, text };
      }),
    );
    texts.push(...parts);
  }

  return texts;
}

function formatGeneratedAt(nowMs: number): string {
  const d = new Date(nowMs);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

export async function loadWorkBoardCards(options?: {
  nowMs?: number;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}): Promise<{
  cards: BoardCard[];
  generatedAt: string;
  source: "github" | "local-dir";
  cacheHit: boolean;
}> {
  const env = options?.env ?? process.env;
  const nowMs = options?.nowMs ?? Date.now();
  const ttl = getCacheTtlMs(env);

  if (cache && cache.expiresAtMs > nowMs) {
    return {
      cards: cache.cards,
      generatedAt: cache.generatedAt,
      source: cache.source,
      cacheHit: true,
    };
  }

  const texts = await fetchOrbitTaskTexts({ env, fetchImpl: options?.fetchImpl });
  const cards = collectBoardCardsFromTexts(texts);
  const generatedAt = formatGeneratedAt(nowMs);
  const source = getLocalTasksDir(env) ? "local-dir" : "github";
  cache = {
    cards,
    generatedAt,
    source,
    expiresAtMs: nowMs + ttl,
  };
  return { cards, generatedAt, source, cacheHit: false };
}
