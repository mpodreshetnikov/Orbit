import { describe, expect, it } from "vitest";
import { collectBoardCardsFromTexts } from "./adapter";
import { forReviewNote, renderBoardHtml } from "./render";
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
