import { describe, expect, it } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const registry = require("./tasks-registry.cjs") as {
  parseFrontMatter: (
    text: string,
    label: string,
  ) => { data: Record<string, unknown> | null; body: string; errors: string[] };
  validateTask: (fileName: string, data: Record<string, unknown>, body: string) => string[];
  validateAdr: (fileName: string, data: Record<string, unknown>, body: string) => string[];
  validateCrossReferences: (
    tasks: Record<string, unknown>[],
    adrs: Record<string, unknown>[],
  ) => string[];
  renderTable: (headers: string[], rows: string[][]) => string;
  renderIndex: (tasks: Record<string, unknown>[], adrs: Record<string, unknown>[]) => string;
  compareTasks: (a: Record<string, unknown>, b: Record<string, unknown>) => number;
};

const NOTE_BODY =
  "\n# Title\n\n## Context\n\nx\n\n## Progress\n\n- [ ] x\n\n## Decision Log\n\n- x\n";
const ADR_BODY = "\n## Context\n\nx\n\n## Decision\n\nx\n\n## Consequences\n\nx\n";

function validTask(overrides: Record<string, unknown> = {}) {
  return {
    id: "T-0012",
    title: "Do the thing",
    status: "open",
    kind: "feature",
    priority: "p2",
    depth: "note",
    created: "2026-08-13",
    updated: "2026-08-13",
    owner: "TBD",
    ...overrides,
  };
}

describe("parseFrontMatter", () => {
  it("parses scalars, inline lists and quoted values", () => {
    const { data, body, errors } = registry.parseFrontMatter(
      `---\nid: T-0001\ntags: [health, mcp]\nexit: "a: b, with commas"\n---\n\n# Heading\n`,
      "f",
    );

    expect(errors).toEqual([]);
    expect(data).toMatchObject({
      id: "T-0001",
      tags: ["health", "mcp"],
      exit: "a: b, with commas",
    });
    expect(body).toBe("\n# Heading\n");
  });

  it("parses an empty inline list", () => {
    const { data } = registry.parseFrontMatter(`---\ntags: []\n---\nbody\n`, "f");
    expect(data?.tags).toEqual([]);
  });

  it("reports a missing or unterminated front matter block instead of guessing", () => {
    expect(registry.parseFrontMatter("# No front matter\n", "f").errors).toEqual([
      "f: missing YAML front matter block",
    ]);
    expect(registry.parseFrontMatter("---\nid: T-0001\n", "f").errors).toEqual([
      "f: unterminated front matter block",
    ]);
  });

  it("rejects a line it cannot parse rather than dropping it silently", () => {
    const { errors } = registry.parseFrontMatter(
      `---\nid: T-0001\n  - stray list item\n---\nb\n`,
      "f",
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("unparseable front matter");
  });

  it("rejects a duplicate key", () => {
    const { errors } = registry.parseFrontMatter(`---\nid: T-0001\nid: T-0002\n---\nb\n`, "f");
    expect(errors).toEqual(["f: duplicate front matter key 'id'"]);
  });

  it("normalises CRLF line endings", () => {
    const { data, errors } = registry.parseFrontMatter("---\r\nid: T-0001\r\n---\r\nbody\r\n", "f");
    expect(errors).toEqual([]);
    expect(data?.id).toBe("T-0001");
  });
});

describe("validateTask", () => {
  it("accepts a well-formed note task", () => {
    expect(registry.validateTask("T-0012-do-the-thing.md", validTask(), NOTE_BODY)).toEqual([]);
  });

  it("rejects an id that disagrees with the filename", () => {
    const errors = registry.validateTask("T-0099-do-the-thing.md", validTask(), NOTE_BODY);
    expect(errors.some((error) => error.includes("does not match the filename prefix"))).toBe(true);
  });

  it("rejects an unknown front matter key so typos surface", () => {
    const errors = registry.validateTask(
      "T-0012-do-the-thing.md",
      validTask({ statuss: "open" }),
      NOTE_BODY,
    );
    expect(errors.some((error) => error.includes("unknown front matter key 'statuss'"))).toBe(true);
  });

  it("rejects values outside the enums", () => {
    const errors = registry.validateTask(
      "T-0012-do-the-thing.md",
      validTask({ status: "wip", priority: "high" }),
      NOTE_BODY,
    );
    expect(errors.some((error) => error.includes("'status' must be one of"))).toBe(true);
    expect(errors.some((error) => error.includes("'priority' must be one of"))).toBe(true);
  });

  it("requires an exit condition on debt", () => {
    const withoutExit = registry.validateTask(
      "T-0012-do-the-thing.md",
      validTask({ kind: "debt" }),
      NOTE_BODY,
    );
    expect(withoutExit).toEqual([
      "docs/tasks/T-0012-do-the-thing.md: 'exit' is required and must be a non-empty string",
    ]);

    const withExit = registry.validateTask(
      "T-0012-do-the-thing.md",
      validTask({ kind: "debt", exit: "coverage above 50%" }),
      NOTE_BODY,
    );
    expect(withExit).toEqual([]);
  });

  it("requires a named blocker on a blocked task", () => {
    const errors = registry.validateTask(
      "T-0012-do-the-thing.md",
      validTask({ status: "blocked" }),
      NOTE_BODY,
    );
    expect(errors.some((error) => error.includes("'blocked_by' is required"))).toBe(true);
  });

  it("rejects an updated date earlier than created", () => {
    const errors = registry.validateTask(
      "T-0012-do-the-thing.md",
      validTask({ created: "2026-08-13", updated: "2026-08-01" }),
      NOTE_BODY,
    );
    expect(errors.some((error) => error.includes("is earlier than 'created'"))).toBe(true);
  });

  it("rejects a date that is formatted correctly but is not a real day", () => {
    const errors = registry.validateTask(
      "T-0012-do-the-thing.md",
      validTask({ created: "2026-02-31" }),
      NOTE_BODY,
    );
    expect(errors.some((error) => error.includes("'created' must be a real date"))).toBe(true);
  });

  it("requires the heavier section set at execplan depth", () => {
    const errors = registry.validateTask(
      "T-0012-do-the-thing.md",
      validTask({ depth: "execplan" }),
      NOTE_BODY,
    );
    expect(errors).toContain(
      "docs/tasks/T-0012-do-the-thing.md: depth 'execplan' requires a '## Purpose / Big Picture' section",
    );
    expect(errors).toContain(
      "docs/tasks/T-0012-do-the-thing.md: depth 'execplan' requires a '## Outcomes & Retrospective' section",
    );
  });

  it("rejects a non-slug tag and a title ending in a period", () => {
    const errors = registry.validateTask(
      "T-0012-do-the-thing.md",
      validTask({ tags: ["Health Stuff"], title: "Do the thing." }),
      NOTE_BODY,
    );
    expect(errors.some((error) => error.includes("must be a lowercase slug"))).toBe(true);
    expect(errors.some((error) => error.includes("must not end with a period"))).toBe(true);
  });
});

describe("validateAdr", () => {
  it("accepts a well-formed record and requires its three sections", () => {
    const data = {
      id: "ADR-0002",
      title: "Do it this way",
      status: "accepted",
      date: "2026-08-13",
    };
    const body = "\n## Context\n\nx\n\n## Decision\n\nx\n\n## Consequences\n\nx\n";
    expect(registry.validateAdr("ADR-0002-do-it-this-way.md", data, body)).toEqual([]);

    const missing = registry.validateAdr("ADR-0002-do-it-this-way.md", data, "\n## Context\n\nx\n");
    expect(missing).toContain(
      "docs/tasks/decisions/ADR-0002-do-it-this-way.md: requires a '## Decision' section",
    );
  });

  it("rejects a scalar reference list rather than coercing it to empty", () => {
    // A coerced value would skip the existence check in validateCrossReferences entirely, so the
    // reference would silently go unvalidated.
    const errors = registry.validateAdr(
      "ADR-0002-do-it-this-way.md",
      { id: "ADR-0002", title: "T", status: "accepted", date: "2026-08-13", tasks: "T-9999" },
      ADR_BODY,
    );
    expect(errors).toContain(
      "docs/tasks/decisions/ADR-0002-do-it-this-way.md: 'tasks' must be an inline list, for example [T-0001]",
    );
  });

  it("rejects malformed ids inside both reference lists", () => {
    const errors = registry.validateAdr(
      "ADR-0002-do-it-this-way.md",
      {
        id: "ADR-0002",
        title: "T",
        status: "accepted",
        date: "2026-08-13",
        tasks: ["nope"],
        supersedes: ["T-0001"],
      },
      ADR_BODY,
    );
    expect(errors.some((error) => error.includes("linked task 'nope' must look like T-0001"))).toBe(
      true,
    );
    expect(
      errors.some((error) => error.includes("superseded record 'T-0001' must look like ADR-0001")),
    ).toBe(true);
  });
});

describe("validateCrossReferences", () => {
  const adr = (overrides: Record<string, unknown>) => ({
    id: "ADR-0001",
    title: "T",
    status: "accepted",
    date: "2026-08-13",
    ...overrides,
  });

  it("reports a linked task that does not exist", () => {
    const errors = registry.validateCrossReferences(
      [validTask({ id: "T-0001" })],
      [adr({ tasks: ["T-0001", "T-9999"] })],
    );
    expect(errors).toEqual(["ADR-0001: linked task T-9999 does not exist"]);
  });

  it("reports a superseded record that does not exist", () => {
    const errors = registry.validateCrossReferences([], [adr({ supersedes: ["ADR-9999"] })]);
    expect(errors).toEqual(["ADR-0001: 'supersedes' points at ADR-9999, which does not exist"]);
  });

  it("accepts a supersedes reference to a record that sorts later", () => {
    const errors = registry.validateCrossReferences(
      [],
      [adr({ supersedes: ["ADR-0002"] }), adr({ id: "ADR-0002" })],
    );
    expect(errors).toEqual([]);
  });

  it("reports duplicate task ids", () => {
    const errors = registry.validateCrossReferences(
      [validTask({ id: "T-0001" }), validTask({ id: "T-0001" })],
      [],
    );
    expect(errors.some((error) => error.includes("Duplicate task id T-0001"))).toBe(true);
  });
});

describe("renderTable", () => {
  it("pads every column to its widest cell so Prettier leaves the output alone", () => {
    const table = registry.renderTable(
      ["ID", "Title"],
      [
        ["T-1", "A much longer title"],
        ["T-2", "Short"],
      ],
    );

    const lines = table.split("\n");
    const widths = lines.map((line) => line.length);
    expect(new Set(widths).size).toBe(1);
    expect(lines[1]).toBe("| --- | ------------------- |");
  });

  it("escapes pipes so a title cannot break the table", () => {
    expect(registry.renderTable(["A"], [["x | y"]])).toContain("x \\| y");
  });
});

describe("renderIndex", () => {
  it("orders active work first and reports accurate counts", () => {
    const tasks = [
      { ...validTask({ id: "T-0002", status: "done", priority: "p0" }), tags: [] },
      { ...validTask({ id: "T-0003", status: "in-progress", priority: "p2" }), tags: [] },
      { ...validTask({ id: "T-0001", status: "open", priority: "p1" }), tags: [] },
    ];

    const index = registry.renderIndex(tasks, []);
    expect(index).toContain("Active: 2 (in-progress 1, blocked 0, open 1, idea 0). Closed: 1");
    expect(index.indexOf("T-0003")).toBeLessThan(index.indexOf("T-0001"));
    expect(index.indexOf("T-0001")).toBeLessThan(index.indexOf("T-0002"));
    expect(index).toContain("No decision records yet.");
  });

  it("sorts by priority within a status", () => {
    const sorted = [
      validTask({ id: "T-0002", status: "open", priority: "p3" }),
      validTask({ id: "T-0001", status: "open", priority: "p0" }),
    ].sort(registry.compareTasks);

    expect(sorted.map((task) => task.id)).toEqual(["T-0001", "T-0002"]);
  });
});
