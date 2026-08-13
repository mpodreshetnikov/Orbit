#!/usr/bin/env node

// Shared library for the task registry under docs/tasks. Consumed by tasks-check.cjs (validate)
// and tasks-index.cjs (regenerate the board). Canonical policy lives in docs/tasks/README.md;
// this file is the machine-enforced subset of it.

const fs = require("fs");
const path = require("path");

const STATUSES = ["idea", "open", "in-progress", "blocked", "done", "dropped"];
const KINDS = ["feature", "bug", "debt", "chore", "spike", "docs"];
const PRIORITIES = ["p0", "p1", "p2", "p3"];
const DEPTHS = ["note", "execplan"];
const ADR_STATUSES = ["proposed", "accepted", "superseded"];

const TASK_KEYS = new Set([
  "id",
  "title",
  "status",
  "kind",
  "priority",
  "depth",
  "created",
  "updated",
  "owner",
  "tags",
  "exit",
  "blocked_by",
  "superseded_by",
]);
const ADR_KEYS = new Set(["id", "title", "status", "date", "tasks", "supersedes"]);

const REQUIRED_SECTIONS = {
  note: ["Context", "Progress", "Decision Log"],
  execplan: [
    "Purpose / Big Picture",
    "Progress",
    "Surprises & Discoveries",
    "Decision Log",
    "Outcomes & Retrospective",
  ],
};
const ADR_SECTIONS = ["Context", "Decision", "Consequences"];

// Ordering for the generated board: what needs attention first, what is history last.
const STATUS_ORDER = {
  "in-progress": 0,
  blocked: 1,
  open: 2,
  idea: 3,
  done: 4,
  dropped: 5,
};

const TASK_FILE_RE = /^(T-\d{4})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;
const ADR_FILE_RE = /^(ADR-\d{4})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parse a YAML front matter block. Deliberately minimal: it supports the scalar and inline-list
 * forms the registry schema uses and rejects anything else rather than guessing. A silently
 * mis-parsed field would make the validator lie, which is worse than refusing to parse.
 */
function parseFrontMatter(text, label) {
  const errors = [];
  const normalized = text.replace(/\r\n/g, "\n");

  if (!normalized.startsWith("---\n")) {
    return { data: null, body: normalized, errors: [`${label}: missing YAML front matter block`] };
  }

  const end = normalized.indexOf("\n---\n", 3);
  if (end === -1) {
    return { data: null, body: normalized, errors: [`${label}: unterminated front matter block`] };
  }

  const block = normalized.slice(4, end + 1);
  const body = normalized.slice(end + 5);
  const data = {};

  for (const [index, rawLine] of block.split("\n").entries()) {
    const line = rawLine.trimEnd();
    if (line.trim() === "") {
      continue;
    }

    const match = /^([a-z][a-z0-9_]*):[ \t]*(.*)$/.exec(line);
    if (!match) {
      errors.push(`${label}: unparseable front matter at line ${index + 1}: ${line}`);
      continue;
    }

    const [, key, rawValue] = match;
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      errors.push(`${label}: duplicate front matter key '${key}'`);
      continue;
    }

    data[key] = parseValue(rawValue.trim());
  }

  return { data, body, errors };
}

function parseValue(raw) {
  if (raw.startsWith("[") && raw.endsWith("]")) {
    const inner = raw.slice(1, -1).trim();
    if (inner === "") {
      return [];
    }
    return inner.split(",").map((item) => unquote(item.trim()));
  }

  return unquote(raw);
}

function unquote(value) {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\"/g, '"');
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1);
  }
  return value;
}

function isValidDate(value) {
  if (typeof value !== "string" || !DATE_RE.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function sectionsOf(body) {
  return body
    .split("\n")
    .filter((line) => line.startsWith("## "))
    .map((line) => line.slice(3).trim());
}

function requireEnum(errors, label, data, key, allowed) {
  const value = data[key];
  if (typeof value !== "string" || value === "") {
    errors.push(`${label}: '${key}' is required`);
    return;
  }
  if (!allowed.includes(value)) {
    errors.push(`${label}: '${key}' must be one of ${allowed.join(", ")} (got '${value}')`);
  }
}

function requireText(errors, label, data, key) {
  const value = data[key];
  if (typeof value !== "string" || value.trim() === "") {
    errors.push(`${label}: '${key}' is required and must be a non-empty string`);
  }
}

function validateTask(fileName, data, body) {
  const label = `docs/tasks/${fileName}`;
  const errors = [];

  const fileMatch = TASK_FILE_RE.exec(fileName);
  if (!fileMatch) {
    errors.push(`${label}: filename must look like T-0001-lowercase-slug.md`);
  }

  for (const key of Object.keys(data)) {
    if (!TASK_KEYS.has(key)) {
      errors.push(`${label}: unknown front matter key '${key}'`);
    }
  }

  if (typeof data.id !== "string" || !/^T-\d{4}$/.test(data.id)) {
    errors.push(`${label}: 'id' must look like T-0001`);
  } else if (fileMatch && data.id !== fileMatch[1]) {
    errors.push(`${label}: 'id' (${data.id}) does not match the filename prefix (${fileMatch[1]})`);
  }

  requireText(errors, label, data, "title");
  if (typeof data.title === "string" && data.title.trim().endsWith(".")) {
    errors.push(`${label}: 'title' must not end with a period`);
  }

  requireEnum(errors, label, data, "status", STATUSES);
  requireEnum(errors, label, data, "kind", KINDS);
  requireEnum(errors, label, data, "priority", PRIORITIES);
  requireEnum(errors, label, data, "depth", DEPTHS);
  requireText(errors, label, data, "owner");

  for (const key of ["created", "updated"]) {
    if (!isValidDate(data[key])) {
      errors.push(`${label}: '${key}' must be a real date formatted YYYY-MM-DD`);
    }
  }
  if (isValidDate(data.created) && isValidDate(data.updated) && data.updated < data.created) {
    errors.push(
      `${label}: 'updated' (${data.updated}) is earlier than 'created' (${data.created})`,
    );
  }

  if (data.tags !== undefined) {
    if (!Array.isArray(data.tags)) {
      errors.push(`${label}: 'tags' must be an inline list, for example [health, mcp]`);
    } else {
      for (const tag of data.tags) {
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(tag)) {
          errors.push(`${label}: tag '${tag}' must be a lowercase slug`);
        }
      }
    }
  }

  // Conditionally required fields. Debt without an exit condition is a complaint, and a blocked
  // task without a named blocker is an excuse.
  if (data.kind === "debt") {
    requireText(errors, label, data, "exit");
  }
  if (data.status === "blocked") {
    requireText(errors, label, data, "blocked_by");
  }
  if (data.superseded_by !== undefined && !/^T-\d{4}$/.test(String(data.superseded_by))) {
    errors.push(`${label}: 'superseded_by' must look like T-0001`);
  }

  const required = REQUIRED_SECTIONS[data.depth];
  if (required) {
    const present = new Set(sectionsOf(body));
    for (const section of required) {
      if (!present.has(section)) {
        errors.push(`${label}: depth '${data.depth}' requires a '## ${section}' section`);
      }
    }
  }

  return errors;
}

/** Validate an optional inline list of ids: it must be a list, and every entry must be well formed. */
function validateIdList(errors, label, data, key, pattern, example, noun) {
  const value = data[key];
  if (value === undefined) {
    return;
  }
  if (!Array.isArray(value)) {
    errors.push(`${label}: '${key}' must be an inline list, for example [${example}]`);
    return;
  }
  for (const entry of value) {
    if (!pattern.test(String(entry))) {
      errors.push(`${label}: ${noun} '${entry}' must look like ${example}`);
    }
  }
}

function validateAdr(fileName, data, body) {
  const label = `docs/tasks/decisions/${fileName}`;
  const errors = [];

  const fileMatch = ADR_FILE_RE.exec(fileName);
  if (!fileMatch) {
    errors.push(`${label}: filename must look like ADR-0001-lowercase-slug.md`);
  }

  for (const key of Object.keys(data)) {
    if (!ADR_KEYS.has(key)) {
      errors.push(`${label}: unknown front matter key '${key}'`);
    }
  }

  if (typeof data.id !== "string" || !/^ADR-\d{4}$/.test(data.id)) {
    errors.push(`${label}: 'id' must look like ADR-0001`);
  } else if (fileMatch && data.id !== fileMatch[1]) {
    errors.push(`${label}: 'id' (${data.id}) does not match the filename prefix (${fileMatch[1]})`);
  }

  requireText(errors, label, data, "title");
  requireEnum(errors, label, data, "status", ADR_STATUSES);
  if (!isValidDate(data.date)) {
    errors.push(`${label}: 'date' must be a real date formatted YYYY-MM-DD`);
  }

  // Shape and format of the two reference lists are checked here, where the filename is available
  // for the message. Whether the ids resolve is checked in validateCrossReferences, which needs the
  // whole registry. A scalar such as `tasks: T-0001` must fail rather than be coerced to a list,
  // because coercion would let a reference skip the existence check entirely.
  validateIdList(errors, label, data, "tasks", /^T-\d{4}$/, "T-0001", "linked task");
  validateIdList(errors, label, data, "supersedes", /^ADR-\d{4}$/, "ADR-0001", "superseded record");

  const present = new Set(sectionsOf(body));
  for (const section of ADR_SECTIONS) {
    if (!present.has(section)) {
      errors.push(`${label}: requires a '## ${section}' section`);
    }
  }

  return errors;
}

function loadRegistry(tasksDir) {
  const errors = [];
  const tasks = [];
  const adrs = [];

  if (!fs.existsSync(tasksDir)) {
    return { tasks, adrs, errors: [`Missing task registry directory: ${tasksDir}`] };
  }

  const taskFiles = fs
    .readdirSync(tasksDir)
    .filter((name) => name.endsWith(".md") && name !== "README.md" && name !== "INDEX.md")
    .sort();

  for (const fileName of taskFiles) {
    const raw = fs.readFileSync(path.join(tasksDir, fileName), "utf8");
    const parsed = parseFrontMatter(raw, `docs/tasks/${fileName}`);
    errors.push(...parsed.errors);
    if (!parsed.data) {
      continue;
    }
    errors.push(...validateTask(fileName, parsed.data, parsed.body));
    tasks.push(parsed.data);
  }

  const decisionsDir = path.join(tasksDir, "decisions");
  if (fs.existsSync(decisionsDir)) {
    const adrFiles = fs
      .readdirSync(decisionsDir)
      .filter((name) => name.endsWith(".md") && name !== "README.md")
      .sort();

    for (const fileName of adrFiles) {
      const raw = fs.readFileSync(path.join(decisionsDir, fileName), "utf8");
      const parsed = parseFrontMatter(raw, `docs/tasks/decisions/${fileName}`);
      errors.push(...parsed.errors);
      if (!parsed.data) {
        continue;
      }
      errors.push(...validateAdr(fileName, parsed.data, parsed.body));
      adrs.push(parsed.data);
    }
  }

  errors.push(...validateCrossReferences(tasks, adrs));

  return { tasks, adrs, errors };
}

function validateCrossReferences(tasks, adrs) {
  const errors = [];
  const seen = new Map();

  for (const task of tasks) {
    if (typeof task.id !== "string") {
      continue;
    }
    if (seen.has(task.id)) {
      errors.push(
        `Duplicate task id ${task.id}. Ids are never reused; renumber the branch that merged second.`,
      );
    }
    seen.set(task.id, task);
  }

  for (const task of tasks) {
    if (task.superseded_by && !seen.has(String(task.superseded_by))) {
      errors.push(
        `${task.id}: 'superseded_by' points at ${task.superseded_by}, which does not exist`,
      );
    }
  }

  // Collect every decision id before resolving references, so that an ADR may supersede one that
  // sorts after it. Resolving inside the collection loop would reject a valid forward reference.
  const adrIds = new Set();
  for (const adr of adrs) {
    if (typeof adr.id !== "string") {
      continue;
    }
    if (adrIds.has(adr.id)) {
      errors.push(`Duplicate decision id ${adr.id}`);
    }
    adrIds.add(adr.id);
  }

  for (const adr of adrs) {
    // Non-array values are reported by validateAdr, so skipping them here reports the shape problem
    // once rather than twice.
    for (const taskId of Array.isArray(adr.tasks) ? adr.tasks : []) {
      if (!seen.has(String(taskId))) {
        errors.push(`${adr.id}: linked task ${taskId} does not exist`);
      }
    }
    for (const adrId of Array.isArray(adr.supersedes) ? adr.supersedes : []) {
      if (!adrIds.has(String(adrId))) {
        errors.push(`${adr.id}: 'supersedes' points at ${adrId}, which does not exist`);
      }
    }
  }

  return errors;
}

function compareTasks(a, b) {
  const statusDelta = (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99);
  if (statusDelta !== 0) {
    return statusDelta;
  }
  const priorityDelta = PRIORITIES.indexOf(a.priority) - PRIORITIES.indexOf(b.priority);
  if (priorityDelta !== 0) {
    return priorityDelta;
  }
  return String(a.id).localeCompare(String(b.id));
}

function escapeCell(value) {
  return String(value ?? "").replace(/\|/g, "\\|");
}

/**
 * Render a Markdown table with columns padded to their widest cell, which is the shape Prettier
 * produces. Matching it here keeps the generated index clean under `quality-format-check` instead
 * of needing a formatter exemption.
 *
 * Cells are escaped here rather than by the caller, so a value containing a pipe cannot break the
 * table no matter who calls this.
 */
function renderTable(headers, rows) {
  const safeHeaders = headers.map(escapeCell);
  const safeRows = rows.map((row) => row.map(escapeCell));

  const widths = safeHeaders.map((header, column) =>
    Math.max(header.length, ...safeRows.map((row) => row[column].length), 3),
  );
  const line = (cells) => `| ${cells.map((cell, i) => cell.padEnd(widths[i])).join(" | ")} |`;

  return [
    line(safeHeaders),
    `| ${widths.map((width) => "-".repeat(width)).join(" | ")} |`,
    ...safeRows.map(line),
  ].join("\n");
}

function renderIndex(tasks, adrs) {
  const counts = {};
  for (const status of STATUSES) {
    counts[status] = tasks.filter((task) => task.status === status).length;
  }
  const activeTotal = counts["in-progress"] + counts.blocked + counts.open + counts.idea;
  const closedTotal = counts.done + counts.dropped;

  const rows = [...tasks]
    .sort(compareTasks)
    .map((task) => [
      task.id,
      task.title,
      task.status,
      task.kind,
      task.priority,
      task.depth,
      task.updated,
      Array.isArray(task.tags) ? task.tags.join(", ") : "",
    ]);

  const sections = [
    "# Task Index",
    "",
    "Generated by the `tasks-index` command. Do not edit by hand — edit the task files and",
    "regenerate. Policy for this registry lives in `docs/tasks/README.md`.",
    "",
    `Active: ${activeTotal} (in-progress ${counts["in-progress"]}, blocked ${counts.blocked}, ` +
      `open ${counts.open}, idea ${counts.idea}). ` +
      `Closed: ${closedTotal} (done ${counts.done}, dropped ${counts.dropped}).`,
    "",
    "## Tasks",
    "",
    rows.length > 0
      ? renderTable(["ID", "Title", "Status", "Kind", "Pri", "Depth", "Updated", "Tags"], rows)
      : "No tasks yet.",
    "",
    "## Decisions",
    "",
  ];

  const adrRows = [...adrs]
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
    .map((adr) => [adr.id, adr.title, adr.status, adr.date]);

  sections.push(
    adrRows.length > 0
      ? renderTable(["ID", "Title", "Status", "Date"], adrRows)
      : "No decision records yet.",
    "",
  );

  return `${sections.join("\n")}`;
}

function repoRoot() {
  return path.resolve(__dirname, "..", "..");
}

function tasksDir() {
  return path.join(repoRoot(), "docs", "tasks");
}

function indexPath() {
  return path.join(tasksDir(), "INDEX.md");
}

module.exports = {
  ADR_SECTIONS,
  DEPTHS,
  KINDS,
  PRIORITIES,
  REQUIRED_SECTIONS,
  STATUSES,
  compareTasks,
  indexPath,
  loadRegistry,
  parseFrontMatter,
  renderIndex,
  renderTable,
  repoRoot,
  tasksDir,
  validateAdr,
  validateCrossReferences,
  validateTask,
};
