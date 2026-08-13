#!/usr/bin/env node

// Validate the task registry under docs/tasks: front matter schema, id uniqueness, required body
// sections, cross references, and whether INDEX.md matches the task files. Canonical policy is
// docs/tasks/README.md. This runs inside `quality`, so it gates CI.

const fs = require("fs");

const { indexPath, loadRegistry, renderIndex, tasksDir } = require("./tasks-registry.cjs");

const { tasks, adrs, errors } = loadRegistry(tasksDir());
const problems = [...errors];

const target = indexPath();
if (!fs.existsSync(target)) {
  problems.push("docs/tasks/INDEX.md is missing. Run `just tasks-index` to generate it.");
} else if (errors.length === 0 && fs.readFileSync(target, "utf8") !== renderIndex(tasks, adrs)) {
  problems.push(
    "docs/tasks/INDEX.md is stale — it does not match the task files. Run `just tasks-index`.",
  );
}

if (problems.length > 0) {
  console.error(`Task registry validation failed with ${problems.length} problem(s):\n`);
  for (const problem of problems) {
    console.error(`  - ${problem}`);
  }
  console.error("\nSchema and lifecycle rules: docs/tasks/README.md");
  process.exit(1);
}

const active = tasks.filter((task) => !["done", "dropped"].includes(task.status)).length;
console.log(
  `Task registry is valid: ${tasks.length} task(s), ${active} active, ${adrs.length} decision record(s).`,
);
