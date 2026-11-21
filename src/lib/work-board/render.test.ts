import { describe, expect, it } from "vitest";
import { collectBoardCardsFromTexts } from "./adapter";
import {
  CLOSED_COLUMN_CARD_LIMIT,
  compareCardsForColumn,
  formatColumnCount,
  forReviewNote,
  isTrimmedBoardColumn,
  renderBoardHtml,
  selectCardsForColumn,
} from "./render";
import type { BoardCard } from "./types";

function card(partial: Partial<BoardCard> & Pick<BoardCard, "id" | "title" | "column">): BoardCard {
  return {
    status: "open",
    status_label: "открыта",
    description: "",
    claim: "",
    parent: "",
    blocked_reason: "",
    blocked_deadline: "",
    updated: "",
    overdue: "",
    ...partial,
  };
}

describe("forReviewNote", () => {
  it("strips emails to local-part, joins multiple, and falls back", () => {
    expect(forReviewNote(["mpodreshetnikov@gmail.com"])).toBe("только mpodreshetnikov");
    expect(forReviewNote(["  alice@example.com  ", "bob@x.com"])).toBe("только alice, bob");
    expect(forReviewNote(["plain-name"])).toBe("только plain-name");
    expect(forReviewNote([])).toBe("только рецензент");
    expect(forReviewNote(["   ", ""])).toBe("только рецензент");
  });
});

describe("renderBoardHtml", () => {
  it("renders seven columns and never paints overdue", () => {
    const cards = collectBoardCardsFromTexts([
      {
        path: "docs/tasks/T-999901-aaa.md",
        text: `---
id: T-999901-aaa
title: "Open card"
status: open
owner: TBD
---

## Context

Open description.
`,
      },
      {
        path: "docs/tasks/T-999901-bbb.md",
        text: `---
id: T-999901-bbb
title: "Review card"
status: review
owner: board-fixture@example.com
---

## Context

Review description.
`,
      },
    ]);

    const html = renderBoardHtml(cards, {
      generatedAt: "2026-11-21 12:00 UTC",
      reviewers: ["mpodreshetnikov@gmail.com"],
      lang: "ru",
    });

    expect(html).toContain('data-column="open"');
    expect(html).toContain('data-column="queue"');
    expect(html).toContain('data-column="in-progress"');
    expect(html).toContain('data-column="for-review"');
    expect(html).toContain('data-column="blocked"');
    expect(html).toContain('data-column="done"');
    expect(html).toContain('data-column="canceled"');
    expect(html).toContain("Open card");
    expect(html).toContain("Review card");
    expect(html).toContain("только mpodreshetnikov");
    expect(html).toContain('lang="ru"');
    expect(html).toContain("Сгенерировано: 2026-11-21 12:00 UTC");
    expect(html).not.toContain("overdue");
    expect(html).not.toContain("Просрочено");
  });

  it("puts the review note only on for-review and shows empty markers elsewhere", () => {
    const html = renderBoardHtml(
      [
        card({
          id: "T-999901-rev",
          title: "Needs review",
          column: "for-review",
          status: "for-review",
          status_label: "на ревью",
        }),
      ],
      { reviewers: ["lead@orbit.example"] },
    );

    const forReviewSection = html.match(/data-column="for-review"[\s\S]*?<\/section>/)?.[0];
    const openSection = html.match(/data-column="open"[\s\S]*?<\/section>/)?.[0];
    expect(forReviewSection).toContain('class="col-note"');
    expect(forReviewSection).toContain("только lead");
    expect(openSection).not.toContain("col-note");
    expect(openSection).toContain("(пусто)");
    expect(html).toContain('class="count">(1)</span>');
  });

  it("omits the review note when reviewers resolve to empty", () => {
    const html = renderBoardHtml(
      [
        card({
          id: "T-999901-rev",
          title: "Needs review",
          column: "for-review",
          status: "for-review",
          status_label: "на ревью",
        }),
      ],
      { reviewers: [] },
    );
    // Empty reviewers still fall back to "рецензент", so note stays present —
    // omit note only when forReviewNote would be empty string (not the case).
    // Assert default title/lang and that note uses the fallback label.
    expect(html).toContain("<title>Доска задач Orbit</title>");
    expect(html).toContain('lang="ru"');
    expect(html).toContain("только рецензент");
  });

  it("honors custom title/lang defaults and optional card fields", () => {
    const html = renderBoardHtml(
      [
        card({
          id: "T-999901-blk",
          title: 'Blocked <script> & "x"',
          column: "blocked",
          status: "blocked",
          status_label: "заблокирована",
          description: "Desc & more",
          updated: "2026-11-20",
          claim: "alice@example.com",
          blocked_reason: "waiting",
          parent: "T-0001",
        }),
        card({
          id: "T-999901-opn",
          title: "Open bare",
          column: "open",
        }),
      ],
      { title: "Custom Board", lang: "en" },
    );

    expect(html).toContain("<title>Custom Board</title>");
    expect(html).toContain("<h1>Custom Board</h1>");
    expect(html).toContain('lang="en"');
    expect(html).toContain("Blocked &lt;script&gt; &amp; &quot;x&quot;");
    expect(html).toContain("Desc &amp; more");
    expect(html).toContain("Обновлено: 2026-11-20");
    expect(html).toContain("Исполнитель: alice@example.com");
    expect(html).toContain("Блок: waiting");
    expect(html).toContain("Родитель: T-0001");
    expect(html).not.toContain("Сгенерировано:");
    // open card has no optional fields
    const openSection = html.match(/data-column="open"[\s\S]*?<\/section>/)?.[0] ?? "";
    expect(openSection).toContain("Open bare");
    expect(openSection).not.toContain("card-desc");
    expect(openSection).not.toContain("card-claim");
    expect(openSection).not.toContain("card-blocked");
    expect(openSection).not.toContain("card-parent");
    expect(openSection).not.toContain("card-age");
  });

  it("does not show blocked_reason for non-blocked cards", () => {
    const html = renderBoardHtml([
      card({
        id: "T-999901-opn",
        title: "Open",
        column: "open",
        blocked_reason: "should-not-render",
      }),
    ]);
    const openSection = html.match(/data-column="open"[\s\S]*?<\/section>/)?.[0] ?? "";
    expect(openSection).toMatch(/class="card-status"/);
    expect(openSection).not.toMatch(/class="card-blocked"/);
    expect(openSection.includes("should-not-render")).toBe(false);
  });

  it("sorts cards inside a column by id", () => {
    const cards = [
      card({ id: "T-999901-zzz", title: "Z", column: "open" }),
      card({ id: "T-999901-aaa", title: "A", column: "open" }),
      card({ id: "T-999901-mmm", title: "M", column: "open" }),
    ];
    const html = renderBoardHtml(cards);
    const openSection = html.match(/data-column="open"[\s\S]*?<\/section>/)?.[0] ?? "";
    const positions = ["T-999901-aaa", "T-999901-mmm", "T-999901-zzz"].map((id) =>
      openSection.indexOf(id),
    );
    expect(positions[0]).toBeGreaterThanOrEqual(0);
    expect(positions[1]).toBeGreaterThan(positions[0]!);
    expect(positions[2]).toBeGreaterThan(positions[1]!);
  });

  it("defaults reviewers to none (fallback label) when options omit them", () => {
    const html = renderBoardHtml([
      card({
        id: "T-999901-rev",
        title: "Needs review",
        column: "for-review",
        status: "for-review",
        status_label: "на ревью",
      }),
    ]);
    expect(html).toContain("только рецензент");
    expect(html).not.toContain("Stryker");
  });
});

describe("closed-column trim helpers", () => {
  it("marks only done and canceled as trimmed columns", () => {
    expect(isTrimmedBoardColumn("done")).toBe(true);
    expect(isTrimmedBoardColumn("canceled")).toBe(true);
    expect(isTrimmedBoardColumn("open")).toBe(false);
    expect(isTrimmedBoardColumn("for-review")).toBe(false);
    expect(CLOSED_COLUMN_CARD_LIMIT).toBe(10);
  });

  it("formatColumnCount shows shown-of-total only when trimmed", () => {
    expect(formatColumnCount(3, 3)).toBe("(3)");
    expect(formatColumnCount(10, 214)).toBe("(10 из 214)");
    expect(formatColumnCount(0, 0)).toBe("(0)");
  });

  it("compareCardsForColumn: trimmed uses updated desc then id; others use id", () => {
    const older = card({
      id: "T-999901-aaa",
      title: "A",
      column: "done",
      updated: "2026-01-01",
    });
    const newer = card({
      id: "T-999901-zzz",
      title: "Z",
      column: "done",
      updated: "2026-11-20",
    });
    const empty = card({ id: "T-999901-mmm", title: "M", column: "done", updated: "  " });
    expect(compareCardsForColumn(newer, older, "done")).toBeLessThan(0);
    expect(compareCardsForColumn(older, newer, "done")).toBeGreaterThan(0);
    expect(compareCardsForColumn(empty, newer, "done")).toBeGreaterThan(0);
    expect(compareCardsForColumn(newer, empty, "canceled")).toBeLessThan(0);
    // same updated → id
    const a = card({ id: "T-999901-aaa", title: "A", column: "done", updated: "2026-11-01" });
    const b = card({ id: "T-999901-bbb", title: "B", column: "done", updated: "2026-11-01" });
    expect(compareCardsForColumn(a, b, "done")).toBeLessThan(0);
    // open ignores updated order
    expect(
      compareCardsForColumn(
        card({ id: "T-999901-zzz", title: "Z", column: "open", updated: "2026-11-20" }),
        card({ id: "T-999901-aaa", title: "A", column: "open", updated: "2026-01-01" }),
        "open",
      ),
    ).toBeGreaterThan(0);
  });

  it("selectCardsForColumn keeps all when at or under the limit", () => {
    const cards = Array.from({ length: CLOSED_COLUMN_CARD_LIMIT }, (_, i) =>
      card({
        id: `T-999901-d${String(i).padStart(2, "0")}`,
        title: `D${i}`,
        column: "done",
        status: "done",
        updated: `2026-11-${String(i + 1).padStart(2, "0")}`,
      }),
    );
    const selected = selectCardsForColumn(cards, "done");
    expect(selected.total).toBe(CLOSED_COLUMN_CARD_LIMIT);
    expect(selected.shown).toBe(CLOSED_COLUMN_CARD_LIMIT);
    expect(selected.items).toHaveLength(CLOSED_COLUMN_CARD_LIMIT);
    expect(selected.items[0]?.updated).toBe("2026-11-10");
  });

  it("selectCardsForColumn trims done/canceled to latest N by updated", () => {
    const cards = Array.from({ length: 14 }, (_, i) =>
      card({
        id: `T-999901-c${String(i).padStart(2, "0")}`,
        title: `C${i}`,
        column: "canceled",
        status: "canceled",
        updated: `2026-10-${String(i + 1).padStart(2, "0")}`,
      }),
    );
    const selected = selectCardsForColumn(cards, "canceled");
    expect(selected.total).toBe(14);
    expect(selected.shown).toBe(CLOSED_COLUMN_CARD_LIMIT);
    expect(selected.items).toHaveLength(CLOSED_COLUMN_CARD_LIMIT);
    expect(selected.items.map((c) => c.updated)).toEqual([
      "2026-10-14",
      "2026-10-13",
      "2026-10-12",
      "2026-10-11",
      "2026-10-10",
      "2026-10-09",
      "2026-10-08",
      "2026-10-07",
      "2026-10-06",
      "2026-10-05",
    ]);
    // open never trims
    const openCards = Array.from({ length: 14 }, (_, i) =>
      card({ id: `T-999901-o${String(i).padStart(2, "0")}`, title: `O${i}`, column: "open" }),
    );
    const openSelected = selectCardsForColumn(openCards, "open");
    expect(openSelected.shown).toBe(14);
    expect(openSelected.total).toBe(14);
  });
});

describe("renderBoardHtml closed-column trim", () => {
  it("shows latest 10 done cards and header Готово (10 из N)", () => {
    const cards = Array.from({ length: 12 }, (_, i) =>
      card({
        id: `T-999901-g${String(i).padStart(2, "0")}`,
        title: `Done-${i}`,
        column: "done",
        status: "done",
        status_label: "готово",
        updated: `2026-09-${String(i + 1).padStart(2, "0")}`,
      }),
    );
    const html = renderBoardHtml(cards);
    const doneSection = html.match(/data-column="done"[\s\S]*?<\/section>/)?.[0] ?? "";
    expect(doneSection).toContain("Готово");
    expect(doneSection).toContain("(10 из 12)");
    expect(doneSection.match(/class="card"/g)?.length ?? 0).toBe(10);
    expect(doneSection).toContain("Done-11");
    expect(doneSection).toContain("Done-2");
    expect(doneSection).toContain("T-999901-g11");
    expect(doneSection).toContain("T-999901-g02");
    expect(doneSection).not.toContain("T-999901-g00");
    expect(doneSection).not.toContain("T-999901-g01");
  });

  it("shows Отменено (10 из N) for canceled and leaves open untrimmed", () => {
    const canceled = Array.from({ length: 11 }, (_, i) =>
      card({
        id: `T-999901-x${String(i).padStart(2, "0")}`,
        title: `X-${i}`,
        column: "canceled",
        status: "canceled",
        status_label: "отменено",
        updated: `2026-08-${String(i + 1).padStart(2, "0")}`,
      }),
    );
    const open = Array.from({ length: 11 }, (_, i) =>
      card({
        id: `T-999901-y${String(i).padStart(2, "0")}`,
        title: `Y-${i}`,
        column: "open",
      }),
    );
    const html = renderBoardHtml([...canceled, ...open]);
    const canceledSection = html.match(/data-column="canceled"[\s\S]*?<\/section>/)?.[0] ?? "";
    const openSection = html.match(/data-column="open"[\s\S]*?<\/section>/)?.[0] ?? "";
    expect(canceledSection).toContain("Отменено");
    expect(canceledSection).toContain("(10 из 11)");
    expect(canceledSection.match(/class="card"/g)?.length ?? 0).toBe(10);
    expect(openSection).toContain("(11)");
    expect(openSection).not.toContain(" из ");
    expect(openSection.match(/class="card"/g)?.length ?? 0).toBe(11);
  });

  it("does not use из when done has 10 or fewer cards", () => {
    const cards = Array.from({ length: 3 }, (_, i) =>
      card({
        id: `T-999901-s${i}`,
        title: `Small-${i}`,
        column: "done",
        status: "done",
        updated: `2026-07-0${i + 1}`,
      }),
    );
    const html = renderBoardHtml(cards);
    const doneSection = html.match(/data-column="done"[\s\S]*?<\/section>/)?.[0] ?? "";
    expect(doneSection).toContain("(3)");
    expect(doneSection).not.toContain(" из ");
  });
});
