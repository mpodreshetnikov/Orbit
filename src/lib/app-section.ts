export type AppSection = "health" | "money";

export function getAppSection(pathname?: string | null): AppSection {
  if (!pathname) return "health";
  if (pathname.startsWith("/money")) return "money";
  return "health";
}

export function isMoneySection(pathname?: string | null): boolean {
  return getAppSection(pathname) === "money";
}
