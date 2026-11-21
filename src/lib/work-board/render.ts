import { BOARD_COLUMNS } from "./adapter";
import type { BoardCard, BoardColumnId } from "./types";

const DEFAULT_TITLE = "Доска задач Orbit";

const UI = {
  intro: "Живая доска orbit-tasks — серверный рендер с коротким кэшем.",
  status: "Статус",
  claim: "Исполнитель",
  blocked: "Блок",
  deadline: "Дедлайн",
  parent: "Родитель",
  subtasks: "Подзадачи",
  age: "Обновлено",
  generated: "Сгенерировано",
  empty: "(пусто)",
} as const;

const CSS = [
  ":root{--bg:#0f1419;--col:#1a2332;--card:#243044;--fg:#e7ecf3;",
  "--muted:#9aa7b8;--acc:#5b9fd4;--warn:#e8a060;--bad:#e8a0a0}",
  "*{box-sizing:border-box}",
  "body{margin:0;font-family:ui-sans-serif,system-ui,sans-serif;background:var(--bg);color:var(--fg)}",
  "header{padding:1.25rem 1.5rem;border-bottom:1px solid #2a3548}",
  "header h1{margin:0;font-size:1.35rem;font-weight:650}",
  "header p{margin:.35rem 0 0;color:var(--muted);font-size:.9rem}",
  ".board{display:flex;gap:.55rem;padding:1rem;overflow-x:auto;align-items:flex-start}",
  ".column{flex:0 0 10rem;background:var(--col);border-radius:8px;padding:.6rem;min-height:12rem}",
  ".column h2{margin:0 0 .6rem;font-size:.78rem;text-transform:uppercase;",
  "letter-spacing:.04em;color:var(--muted);font-weight:600}",
  ".column .count{color:var(--acc);font-weight:500}",
  ".column .col-note{display:block;font-size:.68rem;font-weight:500;",
  "text-transform:none;letter-spacing:0;color:var(--acc);margin-top:.2rem}",
  ".card{background:var(--card);border-radius:6px;padding:.55rem .6rem;margin:0 0 .5rem}",
  ".card-title{margin:0 0 .3rem;font-size:.88rem;line-height:1.3}",
  ".card-id,.card-status,.card-claim,.card-desc,.card-blocked,",
  ".card-deadline,.card-parent,.card-subtasks,.card-age{margin:.15rem 0;font-size:.72rem;color:var(--muted)}",
  ".card-desc{color:var(--fg)}",
  ".card-blocked{color:var(--bad)}",
  ".empty{color:var(--muted);font-size:.75rem;font-style:italic}",
].join("");

function escapeHtml(text: string | null | undefined): string {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function displayParticipant(raw: string): string {
  const text = raw.trim();
  const at = text.indexOf("@");
  return at === -1 ? text : text.slice(0, at);
}

export function forReviewNote(participants: string[]): string {
  const names = participants.map(displayParticipant).filter(Boolean);
  const name = names.length > 0 ? names.join(", ") : "рецензент";
  return `только ${name}`;
}

function renderCard(card: BoardCard): string {
  const parts = [
    '<article class="card">',
    `<h3 class="card-title">${escapeHtml(card.title)}</h3>`,
    `<p class="card-id">${escapeHtml(card.id)}</p>`,
  ];
  if (card.description) {
    parts.push(`<p class="card-desc">${escapeHtml(card.description)}</p>`);
  }
  parts.push(
    `<p class="card-status">${escapeHtml(UI.status)}: ${escapeHtml(card.status_label)}</p>`,
  );
  if (card.updated) {
    parts.push(`<p class="card-age">${escapeHtml(UI.age)}: ${escapeHtml(card.updated)}</p>`);
  }
  if (card.claim) {
    parts.push(`<p class="card-claim">${escapeHtml(UI.claim)}: ${escapeHtml(card.claim)}</p>`);
  }
  if (card.status === "blocked" && card.blocked_reason) {
    parts.push(
      `<p class="card-blocked">${escapeHtml(UI.blocked)}: ${escapeHtml(card.blocked_reason)}</p>`,
    );
  }
  if (card.parent) {
    parts.push(`<p class="card-parent">${escapeHtml(UI.parent)}: ${escapeHtml(card.parent)}</p>`);
  }
  parts.push("</article>");
  return parts.join("\n");
}

function renderColumn(
  colId: BoardColumnId,
  colLabel: string,
  items: BoardCard[],
  reviewNote: string,
): string {
  const body =
    items.length === 0
      ? `<p class="empty">${escapeHtml(UI.empty)}</p>`
      : items.map(renderCard).join("\n");
  const note =
    colId === "for-review" && reviewNote
      ? `\n<span class="col-note">${escapeHtml(reviewNote)}</span>`
      : "";
  return [
    `<section class="column" data-column="${escapeHtml(colId)}">`,
    `<h2>${escapeHtml(colLabel)} <span class="count">(${items.length})</span>${note}</h2>`,
    body,
    "</section>",
  ].join("\n");
}

export function renderBoardHtml(
  cards: BoardCard[],
  options: {
    generatedAt?: string;
    title?: string;
    reviewers?: string[];
    lang?: string;
  } = {},
): string {
  const title = options.title ?? DEFAULT_TITLE;
  const lang = options.lang ?? "ru";
  const byCol = Object.fromEntries(BOARD_COLUMNS.map(([id]) => [id, [] as BoardCard[]])) as Record<
    BoardColumnId,
    BoardCard[]
  >;
  for (const card of cards) {
    byCol[card.column].push(card);
  }

  const note = forReviewNote(options.reviewers ?? []);
  const columnsHtml = BOARD_COLUMNS.map(([colId, colLabel]) => {
    const items = byCol[colId].slice().sort((a, b) => a.id.localeCompare(b.id));
    return renderColumn(colId, colLabel, items, note);
  });

  const stamp = options.generatedAt
    ? `\n<p class="stamp">${escapeHtml(UI.generated)}: ${escapeHtml(options.generatedAt)}</p>`
    : "";

  return [
    "<!DOCTYPE html>",
    `<html lang="${escapeHtml(lang)}">`,
    "<head>",
    '<meta charset="utf-8">',
    `<title>${escapeHtml(title)}</title>`,
    `<style>${CSS}</style>`,
    "</head>",
    "<body>",
    "<header>",
    `<h1>${escapeHtml(title)}</h1>`,
    `<p>${escapeHtml(UI.intro)}</p>${stamp}`,
    "</header>",
    '<main class="board">',
    columnsHtml.join("\n"),
    "</main>",
    "</body>",
    "</html>",
    "",
  ].join("\n");
}
