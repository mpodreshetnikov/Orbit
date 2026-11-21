import type {
  AgentizedCanonicalStatus,
  BoardCard,
  BoardColumnId,
  OrbitTaskStatus,
  TaskTextSource,
} from "./types";

export const BOARD_COLUMNS: ReadonlyArray<readonly [BoardColumnId, string]> = [
  ["open", "Открыто"],
  ["queue", "Очередь"],
  ["in-progress", "В работе"],
  ["for-review", "На ревью"],
  ["blocked", "Заблокировано"],
  ["done", "Готово"],
  ["canceled", "Отменено"],
] as const;

const COLUMN_FOR_STATUS: Record<AgentizedCanonicalStatus, BoardColumnId> = {
  idea: "open",
  open: "open",
  queue: "queue",
  "self-review": "queue",
  "in-progress": "in-progress",
  "for-review": "for-review",
  blocked: "blocked",
  done: "done",
  canceled: "canceled",
};

const STATUS_LABEL_RU: Record<AgentizedCanonicalStatus, string> = {
  idea: "идея",
  open: "открыта",
  queue: "очередь",
  "in-progress": "в работе",
  "self-review": "самопроверка",
  "for-review": "на ревью",
  blocked: "заблокирована",
  done: "готово",
  canceled: "отменена",
};

const ORBIT_TO_CANONICAL: Record<OrbitTaskStatus, AgentizedCanonicalStatus> = {
  idea: "idea",
  open: "open",
  "in-progress": "in-progress",
  review: "for-review",
  blocked: "blocked",
  done: "done",
  dropped: "canceled",
};

const SKIP_BASENAMES = new Set(["readme.md", "plans.md", "index.md"]);

const FRONT_MATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export class BoardAdapterError extends Error {
  constructor(
    readonly path: string,
    reason: string,
  ) {
    super(`${path}: ${reason}`);
    this.name = "BoardAdapterError";
  }
}

function isOrbitStatus(value: string): value is OrbitTaskStatus {
  return Object.prototype.hasOwnProperty.call(ORBIT_TO_CANONICAL, value);
}

export function mapOrbitStatusToCanonical(raw: string): AgentizedCanonicalStatus {
  const status = raw.trim().toLowerCase();
  if (!isOrbitStatus(status)) {
    throw new BoardAdapterError("<status>", `unknown orbit status '${raw}'`);
  }
  return ORBIT_TO_CANONICAL[status];
}

function parseScalar(raw: string): string {
  const trimmed = raw.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseFrontMatter(text: string, path: string): Record<string, string> {
  const match = FRONT_MATTER_RE.exec(text);
  if (!match) {
    throw new BoardAdapterError(path, "missing YAML front matter");
  }
  const out: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) {
      continue;
    }
    const idx = line.indexOf(":");
    if (idx === -1) {
      continue;
    }
    const key = line.slice(0, idx).trim();
    if (!key || key.includes(" ")) {
      continue;
    }
    out[key] = parseScalar(line.slice(idx + 1));
  }
  return out;
}

function extractContextDescription(text: string): string {
  const withoutFm = text.replace(FRONT_MATTER_RE, "");
  const section = withoutFm.match(/^##\s*Context\s*\r?\n([\s\S]*?)(?=^##\s|\Z)/im);
  if (!section) {
    return "";
  }
  const paragraphs = section[1]
    .split(/\r?\n\s*\r?\n/)
    .map((block) =>
      block
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("_") && !line.startsWith("#"))
        .join(" ")
        .trim(),
    )
    .filter(Boolean);
  return paragraphs[0] ?? "";
}

function shouldSkipPath(path: string): boolean {
  const base = path.split(/[/\\]/).pop()?.toLowerCase() ?? "";
  if (SKIP_BASENAMES.has(base)) {
    return true;
  }
  if (!/^T-/i.test(base) || !base.endsWith(".md")) {
    return true;
  }
  // goals/decisions and other nested non-task trees
  const normalized = path.replace(/\\/g, "/").toLowerCase();
  if (normalized.includes("/goals/") || normalized.includes("/decisions/")) {
    return true;
  }
  return false;
}

export function parseOrbitTaskMarkdown(text: string, options: { path: string }): BoardCard {
  const { path } = options;
  const fields = parseFrontMatter(text, path);
  const id = (fields.id || "").trim();
  // Match registry ids: dated `T-YYMMDD-xxx` and legacy `T-NNNN` (see TASK_ID_RE).
  if (!/^T-(?:\d{6}-[a-z0-9]+|\d{4})$/i.test(id)) {
    throw new BoardAdapterError(path, `missing or invalid id ${id || "(empty)"}`);
  }
  const title = (fields.title || "").trim();
  if (!title) {
    throw new BoardAdapterError(path, "missing title");
  }
  const rawStatus = (fields.status || "").trim();
  if (!rawStatus) {
    throw new BoardAdapterError(path, "missing status");
  }
  const status = mapOrbitStatusToCanonical(rawStatus);
  const owner = (fields.owner || "").trim();
  const claim = owner && owner.toUpperCase() !== "TBD" ? owner : "";

  return {
    id,
    title,
    status,
    status_label: STATUS_LABEL_RU[status],
    description: extractContextDescription(text),
    claim,
    parent: "",
    blocked_reason: (fields.blocked_by || "").trim(),
    blocked_deadline: "",
    column: COLUMN_FOR_STATUS[status],
    updated: (fields.updated || "").trim(),
    overdue: "",
  };
}

export function collectBoardCardsFromTexts(sources: TaskTextSource[]): BoardCard[] {
  const cards: BoardCard[] = [];
  const seen = new Map<string, string>();

  for (const source of sources) {
    if (shouldSkipPath(source.path)) {
      continue;
    }
    const card = parseOrbitTaskMarkdown(source.text, { path: source.path });
    const prior = seen.get(card.id);
    if (prior) {
      throw new BoardAdapterError(source.path, `duplicate task id ${card.id} (also ${prior})`);
    }
    seen.set(card.id, source.path);
    cards.push(card);
  }

  return cards;
}
