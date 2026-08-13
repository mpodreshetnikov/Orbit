#!/usr/bin/env node

// Mirror .agents/skills into .claude/skills.
//
// .agents/skills is the source of truth: skills are authored there once and every client reads its
// own directory. Claude Code reads .claude/skills, so without a mirror the two drift silently — and
// they had, by five whole skills and several reference directories, before this script existed.
//
//   node scripts/just/sync-agent-skills.cjs           apply the mirror
//   node scripts/just/sync-agent-skills.cjs --check    fail if the mirror is out of date

const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..", "..");
const sourceDir = path.join(repoRoot, ".agents", "skills");
const targetDir = path.join(repoRoot, ".claude", "skills");

const checkOnly = process.argv.includes("--check");

/** Collect every file under `dir` as a map of POSIX-style relative path to absolute path. */
function collectFiles(dir) {
  const files = new Map();
  if (!fs.existsSync(dir)) {
    return files;
  }

  const walk = (current, prefix) => {
    // Plain code-unit ordering, matching the `.sort()` applied to the diff result below. Using
    // localeCompare here instead would order the two listings differently for the same tree.
    const entries = fs
      .readdirSync(current, { withFileTypes: true })
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(absolute, relative);
      } else if (entry.isFile()) {
        files.set(relative, absolute);
      }
    }
  };

  walk(dir, "");
  return files;
}

/** Compare source and target trees. Returns the work the mirror still owes. */
function diffTrees(source, target) {
  const toCopy = [];
  const toDelete = [];

  for (const [relative, absolute] of source) {
    const targetFile = target.get(relative);
    if (!targetFile) {
      toCopy.push(relative);
      continue;
    }
    if (!fs.readFileSync(absolute).equals(fs.readFileSync(targetFile))) {
      toCopy.push(relative);
    }
  }

  for (const relative of target.keys()) {
    if (!source.has(relative)) {
      toDelete.push(relative);
    }
  }

  return { toCopy: toCopy.sort(), toDelete: toDelete.sort() };
}

/** Remove directories that became empty after deleting stale files, without touching the root. */
function pruneEmptyDirs(dir, root) {
  if (dir === root || !dir.startsWith(root) || !fs.existsSync(dir)) {
    return;
  }
  if (fs.readdirSync(dir).length > 0) {
    return;
  }
  fs.rmdirSync(dir);
  pruneEmptyDirs(path.dirname(dir), root);
}

function main() {
  if (!fs.existsSync(sourceDir)) {
    console.error(`Missing skill source directory: ${path.relative(repoRoot, sourceDir)}`);
    process.exit(1);
  }

  const source = collectFiles(sourceDir);
  const target = collectFiles(targetDir);
  const { toCopy, toDelete } = diffTrees(source, target);

  if (toCopy.length === 0 && toDelete.length === 0) {
    console.log(`.claude/skills is in sync with .agents/skills (${source.size} files).`);
    return;
  }

  if (checkOnly) {
    console.error(".claude/skills is out of sync with .agents/skills.\n");
    for (const relative of toCopy) {
      console.error(`  - missing or stale: .claude/skills/${relative}`);
    }
    for (const relative of toDelete) {
      console.error(`  - not in source:    .claude/skills/${relative}`);
    }
    console.error("\nRun `just agent-skills-sync` to mirror them.");
    process.exit(1);
  }

  for (const relative of toCopy) {
    const destination = path.join(targetDir, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source.get(relative), destination);
  }

  for (const relative of toDelete) {
    const destination = path.join(targetDir, relative);
    fs.rmSync(destination, { force: true });
    pruneEmptyDirs(path.dirname(destination), targetDir);
  }

  console.log(
    `Synced .claude/skills from .agents/skills: ${toCopy.length} copied, ${toDelete.length} removed.`,
  );
}

module.exports = { collectFiles, diffTrees };

if (require.main === module) {
  main();
}
