import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  BOARD_COLUMNS,
  BoardAdapterError,
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

function md(fields: Record<string, string>, body = "## Context\n\nBody.\n"): string {
  const fm = Object.entries(fields)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
  return `---\n${fm}\n---\n\n${body}`;
}

describe("mapOrbitStatusToCanonical", () => {
  it("maps review→for-review and dropped→canceled", () => {
    expect(mapOrbitStatusToCanonical("review")).toBe("for-review");
    expect(mapOrbitStatusToCanonical("dropped")).toBe("canceled");
  });

  it("trims and lowercases shared statuses and rejects unknown", () => {
    expect(mapOrbitStatusToCanonical(" Open ")).toBe("open");
    expect(mapOrbitStatusToCanonical("IN-PROGRESS")).toBe("in-progress");
    expect(mapOrbitStatusToCanonical("blocked")).toBe("blocked");
    expect(mapOrbitStatusToCanonical("idea")).toBe("idea");
    expect(mapOrbitStatusToCanonical("done")).toBe("done");
    expect(() => mapOrbitStatusToCanonical("queue")).toThrow(/unknown/i);
    expect(() => mapOrbitStatusToCanonical("")).toThrow(BoardAdapterError);
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
    const text = md({
      id: "T-0024",
      title: '"Legacy fixture"',
      status: "open",
      owner: "TBD",
    });
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

  it("rejects invalid ids and missing required fields", () => {
    expect(() => parseOrbitTaskMarkdown("no front matter", { path: "bad.md" })).toThrow(
      /missing YAML front matter/i,
    );

    expect(() =>
      parseOrbitTaskMarkdown(md({ id: "not-a-task", title: '"x"', status: "open" }), {
        path: "bad-id.md",
      }),
    ).toThrow(/invalid id/i);

    expect(() =>
      parseOrbitTaskMarkdown(md({ id: "T-999901-aaa.extra", title: '"x"', status: "open" }), {
        path: "bad-id-extra.md",
      }),
    ).toThrow(/invalid id/i);

    expect(() =>
      parseOrbitTaskMarkdown(md({ id: "XT-999901-aaa", title: '"x"', status: "open" }), {
        path: "bad-id-prefix.md",
      }),
    ).toThrow(/invalid id/i);

    expect(() =>
      parseOrbitTaskMarkdown(md({ id: "T-999901-aaa", title: '""', status: "open" }), {
        path: "no-title.md",
      }),
    ).toThrow(/missing title/i);

    expect(() =>
      parseOrbitTaskMarkdown(md({ id: "T-999901-aaa", title: '"x"', status: '""' }), {
        path: "no-status.md",
      }),
    ).toThrow(/missing status/i);

    expect(() =>
      parseOrbitTaskMarkdown(
        md({ id: "T-999901-aaa", title: '"x"', status: "open" }).replace(
          "id: T-999901-aaa",
          "id: ",
        ),
        { path: "empty-id.md" },
      ),
    ).toThrow(/\(empty\)/i);
  });

  it("strips matching quotes and keeps mismatched quotes as-is", () => {
    const double = parseOrbitTaskMarkdown(
      md({ id: "T-999901-q1", title: '"Quoted Title"', status: "open", owner: "'alice'" }),
      { path: "T-999901-q1.md" },
    );
    expect(double.title).toBe("Quoted Title");
    expect(double.claim).toBe("alice");

    const mismatched = parseOrbitTaskMarkdown(
      md({ id: "T-999901-q2", title: "\"Broken'", status: "open" }),
      { path: "T-999901-q2.md" },
    );
    expect(mismatched.title).toBe("\"Broken'");

    const singleOnlyStart = parseOrbitTaskMarkdown(
      md({ id: "T-999901-q3", title: "'Broken", status: "open" }),
      { path: "T-999901-q3.md" },
    );
    expect(singleOnlyStart.title).toBe("'Broken");

    // Ends with a quote but does not start with one — must not strip.
    const endQuoteOnly = parseOrbitTaskMarkdown(
      md({ id: "T-999901-q3b", title: 'Broken"', status: "open" }),
      { path: "T-999901-q3b.md" },
    );
    expect(endQuoteOnly.title).toBe('Broken"');

    // Inner spaces survive quote stripping and need the post-parse trim.
    const padded = parseOrbitTaskMarkdown(
      md({
        id: '" T-999901-q4 "',
        title: '"  Padded  "',
        status: '" open "',
        owner: '" TBD "',
        updated: '" 2026-11-21 "',
        blocked_by: '" reason "',
      }),
      { path: "T-999901-q4.md" },
    );
    expect(padded.id).toBe("T-999901-q4");
    expect(padded.title).toBe("Padded");
    expect(padded.claim).toBe("");
    expect(padded.updated).toBe("2026-11-21");
    expect(padded.blocked_reason).toBe("reason");

    expect(() =>
      parseOrbitTaskMarkdown(md({ id: "T-999901-q5", title: '"  "', status: "open" }), {
        path: "T-999901-q5.md",
      }),
    ).toThrow(/missing title/i);
  });

  it("ignores blank/comment/invalid front-matter lines and keys with spaces", () => {
    const text = [
      "---",
      "# comment line",
      "id: T-999901-fm1",
      'title : "With noise"',
      "",
      "status: open",
      "bad key: ignored",
      "nocolon",
      "statusx",
      "owner: TBD",
      'updated: " 2026-11-21 "',
      'blocked_by: " reason "',
      "---",
      "",
      "## Context",
      "",
      "Kept.",
      "",
    ].join("\n");
    const card = parseOrbitTaskMarkdown(text, { path: "T-999901-fm1.md" });
    expect(card.id).toBe("T-999901-fm1");
    expect(card.title).toBe("With noise");
    expect(card.status).toBe("open");
    expect(card.updated).toBe("2026-11-21");
    expect(card.blocked_reason).toBe("reason");
    expect(card.claim).toBe("");
  });

  it("takes description from first Context paragraph and filters noise lines", () => {
    const text = readFileSync(join(fixturesDir, "T-999901-bbb-fixture-review.md"), "utf8");
    const card = parseOrbitTaskMarkdown(text, { path: "review.md" });
    expect(card.status).toBe("for-review");
    expect(card.column).toBe("for-review");
    expect(card.description).toBe("First context paragraph for review mapping.");

    const noisy = parseOrbitTaskMarkdown(
      md(
        { id: "T-999901-ctx", title: '"Ctx"', status: "open" },
        [
          "## Context",
          "",
          "_italic noise_",
          "# heading noise",
          "Real paragraph line one",
          "continued",
          "",
          "Second paragraph ignored",
          "",
          "## Next",
          "",
          "Other section",
        ].join("\n"),
      ),
      { path: "T-999901-ctx.md" },
    );
    expect(noisy.description).toBe("Real paragraph line one continued");

    const noContext = parseOrbitTaskMarkdown(
      md({ id: "T-999901-nc", title: '"No"', status: "open" }, "## Other\n\nNope.\n"),
      { path: "T-999901-nc.md" },
    );
    expect(noContext.description).toBe("");

    const indentedHeading = parseOrbitTaskMarkdown(
      md(
        { id: "T-999901-ih", title: '"IH"', status: "open" },
        "  ## Context\n\nNot a real section.\n",
      ),
      { path: "T-999901-ih.md" },
    );
    expect(indentedHeading.description).toBe("");

    const spacedContext = parseOrbitTaskMarkdown(
      [
        "---",
        "id: T-999901-sc",
        'title: "SC"',
        "status: open",
        "---",
        "",
        "##  Context ",
        "Spaced heading body.",
        "## Next",
        "Other section must not leak.",
        "",
      ].join("\n"),
      { path: "T-999901-sc.md" },
    );
    expect(spacedContext.description).toBe("Spaced heading body.");
    expect(spacedContext.description).not.toContain("Other section");
    expect(spacedContext.description).not.toContain("## Next");

    const midLineHash = parseOrbitTaskMarkdown(
      [
        "---",
        "id: T-999901-mh",
        'title: "MH"',
        "status: open",
        "---",
        "",
        "## Context",
        "Has an inline ## marker that is not a heading.",
      ].join("\n"),
      { path: "T-999901-mh.md" },
    );
    expect(midLineHash.description).toBe("Has an inline ## marker that is not a heading.");

    const whitespaceNoise = parseOrbitTaskMarkdown(
      [
        "---",
        "id: T-999901-ws",
        'title: "WS"',
        "status: open",
        "---",
        "",
        "## Context",
        "",
        "",
        "",
        "Keep me",
        "  trail_",
        "_drop_",
        "#drop",
        "",
      ].join("\n"),
      { path: "T-999901-ws.md" },
    );
    // Leading blank paragraphs must not win; per-line trim must collapse indent.
    expect(whitespaceNoise.description).toBe("Keep me trail_");
  });

  it("maps blocked_by to blocked_reason and owner to claim", () => {
    const text = readFileSync(join(fixturesDir, "T-999901-ddd-fixture-blocked.md"), "utf8");
    const card = parseOrbitTaskMarkdown(text, { path: "blocked.md" });
    expect(card.column).toBe("blocked");
    expect(card.blocked_reason).toBe("Waiting on fixture credential");
    expect(card.claim).toBe("board-fixture@example.com");
  });

  it("treats TBD / blank owners as empty claim and keeps real owners", () => {
    expect(
      parseOrbitTaskMarkdown(
        md({ id: "T-999901-t1", title: '"a"', status: "open", owner: "TBD" }),
        {
          path: "t1.md",
        },
      ).claim,
    ).toBe("");
    expect(
      parseOrbitTaskMarkdown(
        md({ id: "T-999901-t2", title: '"a"', status: "open", owner: "tbd" }),
        {
          path: "t2.md",
        },
      ).claim,
    ).toBe("");
    expect(
      parseOrbitTaskMarkdown(
        md({ id: "T-999901-t3", title: '"a"', status: "open", owner: "  Alice  " }),
        { path: "t3.md" },
      ).claim,
    ).toBe("Alice");
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

  it("ignores README-like, non-task, and goals/decisions paths", () => {
    const open = readFileSync(join(fixturesDir, "T-999901-aaa-fixture-open.md"), "utf8");
    expect(
      collectBoardCardsFromTexts([
        { path: "README.md", text: "ignore" },
        { path: "INDEX.md", text: "ignore" },
        { path: "PLANS.md", text: "ignore" },
        { path: "docs/tasks/goals/T-999901-aaa.md", text: open },
        { path: "docs/tasks/decisions/T-999901-aaa.md", text: open },
        { path: "notes.txt", text: open },
        { path: "T-999901-aaa.txt", text: open },
        { path: "XT-999901-aaa.md", text: open },
        { path: "T-999901-aaa.md", text: open },
        {
          path: "docs\\tasks\\T-999901-zzz.md",
          text: open.replace("T-999901-aaa", "T-999901-zzz"),
        },
      ]).map((c) => c.id),
    ).toEqual(["T-999901-aaa", "T-999901-zzz"]);
  });

  it("fails on duplicate ids and keeps the prior path in the message", () => {
    const open = readFileSync(join(fixturesDir, "T-999901-aaa-fixture-open.md"), "utf8");
    expect(() =>
      collectBoardCardsFromTexts([
        { path: "T-999901-aaa-a.md", text: open },
        { path: "T-999901-aaa-b.md", text: open },
      ]),
    ).toThrow(/duplicate.*T-999901-aaa.*T-999901-aaa-a\.md/i);
  });

  it("includes the source path when parse rejects a task file", () => {
    expect(() =>
      collectBoardCardsFromTexts([{ path: "docs/tasks/T-999901-bad.md", text: "not yaml" }]),
    ).toThrow(/docs\/tasks\/T-999901-bad\.md: missing YAML front matter/);
  });
});
