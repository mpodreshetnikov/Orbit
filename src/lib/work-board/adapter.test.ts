import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  BOARD_COLUMNS,
  collectBoardCardsFromTexts,
  mapOrbitStatusToCanonical,
  parseOrbitTaskMarkdown,
} from "./adapter";

const fixturesDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../test/fixtures/work-board",
);

function loadFixtures(): Array<{ path: string; text: string }> {
  return readdirSync(fixturesDir)
    .filter((name) => name.startsWith("T-") && name.endsWith(".md"))
    .sort()
    .map((name) => ({
      path: name,
      text: readFileSync(join(fixturesDir, name), "utf8"),
    }));
}

describe("mapOrbitStatusToCanonical", () => {
  it("maps review→for-review and dropped→canceled", () => {
    expect(mapOrbitStatusToCanonical("review")).toBe("for-review");
    expect(mapOrbitStatusToCanonical("dropped")).toBe("canceled");
  });

  it("keeps shared statuses and rejects unknown", () => {
    expect(mapOrbitStatusToCanonical("open")).toBe("open");
    expect(mapOrbitStatusToCanonical("in-progress")).toBe("in-progress");
    expect(mapOrbitStatusToCanonical("blocked")).toBe("blocked");
    expect(() => mapOrbitStatusToCanonical("queue")).toThrow(/unknown/i);
  });
});

describe("parseOrbitTaskMarkdown", () => {
  it("uses front-matter id, not filename stem", () => {
    const text = readFileSync(join(fixturesDir, "T-999901-aaa-fixture-open.md"), "utf8");
    const card = parseOrbitTaskMarkdown(text, { path: "T-999901-aaa-fixture-open.md" });
    expect(card.id).toBe("T-999901-aaa");
    expect(card.id).not.toBe("T-999901-aaa-fixture-open");
    expect(card.title).toBe("Fixture open backlog item");
    expect(card.column).toBe("open");
    expect(card.overdue).toBe("");
  });

  it("accepts legacy four-digit task ids without aborting the board", () => {
    const text = `---
id: T-0024
title: "Legacy fixture"
status: open
owner: TBD
---

## Context

Legacy id format still in the registry.
`;
    const card = parseOrbitTaskMarkdown(text, { path: "T-0024-legacy.md" });
    expect(card.id).toBe("T-0024");
    expect(card.column).toBe("open");

    const cards = collectBoardCardsFromTexts([
      { path: "T-0024-legacy.md", text },
      {
        path: "T-999901-aaa.md",
        text: readFileSync(join(fixturesDir, "T-999901-aaa-fixture-open.md"), "utf8"),
      },
    ]);
    expect(cards.map((c) => c.id).sort()).toEqual(["T-0024", "T-999901-aaa"]);
  });

  it("takes description from first Context paragraph", () => {
    const text = readFileSync(join(fixturesDir, "T-999901-bbb-fixture-review.md"), "utf8");
    const card = parseOrbitTaskMarkdown(text, { path: "review.md" });
    expect(card.status).toBe("for-review");
    expect(card.column).toBe("for-review");
    expect(card.description).toBe("First context paragraph for review mapping.");
  });

  it("maps blocked_by to blocked_reason and owner to claim", () => {
    const text = readFileSync(join(fixturesDir, "T-999901-ddd-fixture-blocked.md"), "utf8");
    const card = parseOrbitTaskMarkdown(text, { path: "blocked.md" });
    expect(card.column).toBe("blocked");
    expect(card.blocked_reason).toBe("Waiting on fixture credential");
    expect(card.claim).toBe("board-fixture@example.com");
  });
});

describe("collectBoardCardsFromTexts", () => {
  it("places every orbit status into the seven agentized columns without overdue", () => {
    const cards = collectBoardCardsFromTexts(loadFixtures());
    const byColumn = Object.fromEntries(
      BOARD_COLUMNS.map(([id]) => [id, [] as string[]]),
    ) as Record<string, string[]>;
    for (const card of cards) {
      expect(card.overdue).toBe("");
      byColumn[card.column].push(card.id);
    }

    expect(byColumn.open.sort()).toEqual(["T-999901-aaa", "T-999901-fff"]);
    expect(byColumn.queue).toEqual([]);
    expect(byColumn["in-progress"]).toEqual(["T-999901-eee"]);
    expect(byColumn["for-review"]).toEqual(["T-999901-bbb"]);
    expect(byColumn.blocked).toEqual(["T-999901-ddd"]);
    expect(byColumn.done).toEqual(["T-999901-ggg"]);
    expect(byColumn.canceled).toEqual(["T-999901-ccc"]);
  });

  it("ignores README-like paths and fails on duplicate ids", () => {
    const open = readFileSync(join(fixturesDir, "T-999901-aaa-fixture-open.md"), "utf8");
    expect(
      collectBoardCardsFromTexts([
        { path: "README.md", text: "ignore" },
        { path: "INDEX.md", text: "ignore" },
        { path: "T-999901-aaa.md", text: open },
      ]),
    ).toHaveLength(1);

    expect(() =>
      collectBoardCardsFromTexts([
        { path: "T-999901-aaa-a.md", text: open },
        { path: "T-999901-aaa-b.md", text: open },
      ]),
    ).toThrow(/duplicate/i);
  });
});
