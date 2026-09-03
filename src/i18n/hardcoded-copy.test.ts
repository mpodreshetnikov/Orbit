import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Every string a person can read on screen goes through the message catalogue.
 *
 * The catalogue's `en.json` and `ru.json` share one key set, so a string that reaches it is
 * translated. The strings that stayed English on a Russian screen were the ones that never
 * reached it: JSX written straight into the import page ("Import history range", "Since last
 * import"), the fallbacks in its error handlers, the column headers of the import report. No
 * check looked for those, so every new panel could ship the same way.
 *
 * This walks the app's components and fails on copy written straight into JSX. Files that
 * still carry such copy are listed below; each is a debt, not an exemption. Clean one and the
 * test asks that it be removed from the list, so the list cannot go stale.
 */

const ROOT = join(__dirname, "..");
const SCANNED_DIRS = ["app", "components"];

/**
 * Known debt. Keep alphabetical. A file listed here that no longer has hardcoded copy fails the
 * test until it is removed.
 */
const FILES_WITH_KNOWN_HARDCODED_COPY = new Set<string>([
  "app/health/measurements/[code]/page.tsx",
  "app/health/observations/[obsCode]/page.tsx",
  "app/money/accounts/page.tsx",
  "app/money/transactions/[id]/page.tsx",
  "app/oauth/authorize/page.tsx",
  "app/settings/notifications-debug/page.tsx",
  "app/settings/page.tsx",
  "components/catalogs/body-site-edit-dialog.tsx",
  "components/catalogs/finding-type-edit-dialog.tsx",
  "components/catalogs/measurement-catalog-edit-dialog.tsx",
  "components/catalogs/observation-edit-dialog.tsx",
  "components/layout/scroll-to-top.tsx",
  "components/oauth/consent-form.tsx",
  "components/records/attachment-preview.tsx",
  "components/records/camera-capture.tsx",
  "components/records/record-card.tsx",
  "components/records/record-detail.tsx",
  "components/ui/dialog.tsx",
  "components/ui/sheet.tsx",
]);

/** Attributes whose string value is read by a person or a screen reader. */
const COPY_ATTRIBUTES = new Set([
  "alt",
  "aria-label",
  "description",
  "label",
  "placeholder",
  "title",
]);

/** Two Latin words, or one capitalised word standing alone: copy, not a code or a class name. */
function looksLikeCopy(raw: string): boolean {
  const text = raw.replace(/\s+/g, " ").trim();
  if (!text) return false;
  return /[A-Za-z]{2,}\s+[A-Za-z]{2,}/.test(text) || /^[A-Z][a-z]{2,}[.!?:]?$/.test(text);
}

export interface HardcodedCopyHit {
  line: number;
  kind: "text" | "attribute" | "expression" | "toast";
  text: string;
}

type Stringish = ts.StringLiteral | ts.NoSubstitutionTemplateLiteral | ts.TemplateExpression;

function isStringish(node: ts.Node): node is Stringish {
  return (
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isTemplateExpression(node)
  );
}

/** The fixed parts of a template: `Line items (${n})` is copy whatever `n` is. */
function stringishText(node: Stringish): string {
  const raw = ts.isTemplateExpression(node)
    ? [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join(" ")
    : node.text;
  return raw.replace(/\s+/g, " ").trim();
}

/**
 * A toast is read by a person as surely as a heading is. Its argument is the one call
 * argument treated as copy; `t("...")`, `cn("...")` and `format(x, "...")` are the callee's.
 */
function isToastArgument(node: ts.Node): boolean {
  let current: ts.Node = node;
  while (current.parent && !ts.isCallExpression(current.parent)) {
    if (
      ts.isJsxExpression(current.parent) ||
      ts.isPropertyAssignment(current.parent) ||
      ts.isFunctionLike(current.parent)
    ) {
      return false;
    }
    current = current.parent;
  }
  const call = current.parent;
  if (!call || !ts.isCallExpression(call) || !call.arguments.includes(current as ts.Expression)) {
    return false;
  }
  return /^toast(\.\w+)?$/.test(call.expression.getText());
}

function enclosingJsxExpression(node: ts.Node): ts.JsxExpression | null {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (ts.isJsxExpression(current)) return current;
    // A call's arguments are the callee's business: t("..."), cn("..."), format(x, "...").
    if (ts.isCallExpression(current) || ts.isNewExpression(current)) return null;
    // Object literals and template pieces are data, not copy.
    if (ts.isPropertyAssignment(current) || ts.isTemplateSpan(current)) return null;
    // An element inside the expression -- `{busy && <Loader className="..." />}` -- is judged
    // by its own attributes, above; its class names are not this expression's copy.
    if (
      ts.isJsxAttribute(current) ||
      ts.isJsxElement(current) ||
      ts.isJsxSelfClosingElement(current) ||
      ts.isJsxFragment(current) ||
      ts.isFunctionLike(current)
    ) {
      return null;
    }
    current = current.parent;
  }
  return null;
}

export function findHardcodedCopy(source: string, fileName = "file.tsx"): HardcodedCopyHit[] {
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const hits: HardcodedCopyHit[] = [];
  const lineOf = (node: ts.Node) =>
    file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;

  function visit(node: ts.Node): void {
    if (ts.isJsxText(node)) {
      if (looksLikeCopy(node.text)) {
        hits.push({
          line: lineOf(node),
          kind: "text",
          text: node.text.replace(/\s+/g, " ").trim(),
        });
      }
    } else if (
      ts.isJsxAttribute(node) &&
      node.initializer &&
      ts.isStringLiteral(node.initializer)
    ) {
      if (COPY_ATTRIBUTES.has(node.name.getText(file)) && looksLikeCopy(node.initializer.text)) {
        hits.push({ line: lineOf(node), kind: "attribute", text: node.initializer.text });
      }
    } else if (isStringish(node)) {
      const text = stringishText(node);
      if (looksLikeCopy(text)) {
        if (isToastArgument(node)) {
          hits.push({ line: lineOf(node), kind: "toast", text });
        } else {
          const expression = enclosingJsxExpression(node);
          // `{cond ? "Show rows" : "Hide rows"}` as a child is copy; the same inside
          // `className={...}` is not, and only the attributes above are read by a person.
          const attribute =
            expression && ts.isJsxAttribute(expression.parent) ? expression.parent : null;
          if (expression && (!attribute || COPY_ATTRIBUTES.has(attribute.name.getText(file)))) {
            hits.push({ line: lineOf(node), kind: "expression", text });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(file);
  return hits;
}

function listComponentFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) listComponentFiles(path, out);
    else if (path.endsWith(".tsx") && !/\.(test|spec)\.tsx$/.test(entry.name)) out.push(path);
  }
  return out;
}

describe("findHardcodedCopy", () => {
  it("flags JSX text, copy-bearing attributes and string branches in children", () => {
    const hits = findHardcodedCopy(`
      const A = () => (
        <div title="Not signed in">
          <p>Import history range</p>
          <input placeholder="Left kidney" className="h-4 w-4 animate-spin" />
          <span>{open ? "Hide filtered rows" : "Show filtered rows"}</span>
          <b>Custom</b>
          <button onClick={() => toast.success(\`Card merged. Updated \${n} transactions.\`)}>
            {\`Line items (\${lines.length})\`}
          </button>
        </div>
      );
    `);
    expect(hits.map((hit) => hit.text)).toEqual([
      "Not signed in",
      "Import history range",
      "Left kidney",
      "Hide filtered rows",
      "Show filtered rows",
      "Custom",
      "Card merged. Updated transactions.",
      "Line items ( )",
    ]);
  });

  it("leaves translated copy, class names, codes and call arguments alone", () => {
    const hits = findHardcodedCopy(`
      const A = () => (
        <div className={cn("flex items-center", open && "bg-muted")}>
          <p>{t("money.importRangeTitle")}</p>
          <span className={busy ? "h-4 w-4 animate-spin" : "hidden"} data-testid="range-title" />
          <i>{format(date, "dd MMM yyyy")}</i>
          <code>{status ?? "create_new"}</code>
          <em>{" "}</em>
          {busy && <Loader className="h-4 w-4 animate-spin mr-2" />}
          <option value="create_new">{label}</option>
        </div>
      );
    `);
    expect(hits).toEqual([]);
  });
});

describe("app copy goes through the message catalogue", () => {
  const files = SCANNED_DIRS.flatMap((dir) => listComponentFiles(join(ROOT, dir)));

  it("scans the app", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("finds no hardcoded copy outside the files already known to carry it", () => {
    const offenders: string[] = [];
    const cleaned: string[] = [];
    for (const file of files) {
      const name = relative(ROOT, file);
      const hits = findHardcodedCopy(readFileSync(file, "utf8"), file);
      const known = FILES_WITH_KNOWN_HARDCODED_COPY.has(name);
      if (hits.length > 0 && !known) {
        offenders.push(
          `${name}\n${hits.map((hit) => `    ${hit.line}: ${JSON.stringify(hit.text)}`).join("\n")}`,
        );
      }
      if (hits.length === 0 && known) cleaned.push(name);
    }
    expect(
      offenders,
      "Copy written straight into JSX; route it through the message catalogue (t(...)):\n" +
        offenders.join("\n"),
    ).toEqual([]);
    expect(
      cleaned,
      "These files no longer carry hardcoded copy; remove them from FILES_WITH_KNOWN_HARDCODED_COPY:",
    ).toEqual([]);
  });
});
