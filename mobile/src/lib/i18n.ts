import ru from "@orbit-messages/ru.json";

/**
 * The web app's own Russian catalogue, read rather than copied.
 *
 * Every word the client shows that the web app also shows comes from here, so the two surfaces call
 * a skipped dose the same thing and a wording change lands on both. The client is Russian-only for
 * now; the catalogue's English twin is the next file over when it is not.
 */
type Catalogue = { [key: string]: string | Catalogue };

type Values = Record<string, string | number>;

const catalogue = ru as Catalogue;

function lookup(key: string): string | null {
  let node: string | Catalogue | undefined = catalogue;
  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null) {
      return null;
    }
    node = node[part];
  }
  return typeof node === "string" ? node : null;
}

/**
 * The CLDR plural category of `count` in Russian.
 *
 * `Intl.PluralRules` when the engine has it; otherwise Russian's own rule, which is short enough to
 * state and is what the catalogue's `one / few / many / other` branches are written against. A
 * fraction is `other`, as CLDR has it, so half a pill reads exactly as the web app prints it.
 */
export function pluralCategory(count: number): "one" | "few" | "many" | "other" {
  if (typeof Intl !== "undefined" && typeof Intl.PluralRules === "function") {
    return new Intl.PluralRules("ru").select(count) as "one" | "few" | "many" | "other";
  }
  if (!Number.isInteger(count)) {
    return "other";
  }
  const mod10 = Math.abs(count) % 10;
  const mod100 = Math.abs(count) % 100;
  if (mod10 === 1 && mod100 !== 11) {
    return "one";
  }
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return "few";
  }
  return "many";
}

/** The branches of one `{name, plural, one {…} few {…} other {…}}` argument. */
function pluralBranches(body: string): Map<string, string> {
  const branches = new Map<string, string>();
  const pattern = /(=?\w+)\s*\{([^{}]*)\}/g;
  for (let match = pattern.exec(body); match !== null; match = pattern.exec(body)) {
    branches.set(match[1], match[2]);
  }
  return branches;
}

/**
 * Format a catalogue message: `{name}` placeholders and `{name, plural, …}` arguments, the two ICU
 * forms the medication messages use. Anything richer is printed as written rather than guessed at.
 */
export function formatMessage(message: string, values: Values = {}): string {
  const withPlurals = message.replace(
    /\{(\w+),\s*plural,((?:[^{}]|\{[^{}]*\})*)\}/g,
    (whole, name: string, body: string) => {
      const value = values[name];
      if (typeof value !== "number") {
        return whole;
      }
      const branches = pluralBranches(body);
      const chosen =
        branches.get(`=${value}`) ?? branches.get(pluralCategory(value)) ?? branches.get("other");
      return chosen === undefined ? whole : chosen.replace(/#/g, String(value));
    },
  );
  return withPlurals.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in values ? String(values[name]) : whole,
  );
}

/** A catalogue message by its dotted key, formatted. A missing key prints the key itself, which is
 * loud enough to be noticed on a screen and harmless if it is not. */
export function t(key: string, values?: Values): string {
  const message = lookup(key);
  return message === null ? key : formatMessage(message, values);
}
