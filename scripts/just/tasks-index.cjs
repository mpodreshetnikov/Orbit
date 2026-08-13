#!/usr/bin/env node

// Regenerate docs/tasks/INDEX.md from the task files. See docs/tasks/README.md for policy.

const fs = require("fs");

const { indexPath, loadRegistry, renderIndex, tasksDir } = require("./tasks-registry.cjs");

const { tasks, adrs, errors } = loadRegistry(tasksDir());

// The index is generated from front matter, so generating it from invalid front matter would bake
// bad data into the board. Fail first and let `tasks-check` explain what is wrong.
if (errors.length > 0) {
  console.error("Cannot regenerate the task index while the registry is invalid:\n");
  for (const error of errors) {
    console.error(`  - ${error}`);
  }
  console.error("\nRun `just tasks-check` for the full report.");
  process.exit(1);
}

const rendered = renderIndex(tasks, adrs);
const target = indexPath();
const previous = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : null;

if (previous === rendered) {
  console.log(
    `docs/tasks/INDEX.md already up to date (${tasks.length} tasks, ${adrs.length} decisions).`,
  );
  process.exit(0);
}

fs.writeFileSync(target, rendered);
console.log(`Wrote docs/tasks/INDEX.md (${tasks.length} tasks, ${adrs.length} decisions).`);
