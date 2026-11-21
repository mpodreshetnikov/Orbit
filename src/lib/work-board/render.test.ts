import { describe, expect, it } from "vitest";
import { collectBoardCardsFromTexts } from "./adapter";
import { renderBoardHtml } from "./render";

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
    expect(html).not.toContain("overdue");
    expect(html).not.toContain("Просрочено");
  });
});
