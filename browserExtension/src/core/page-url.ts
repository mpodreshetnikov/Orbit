/**
 * Whether a path is the given page, or something the bank serves beneath it.
 *
 * Banks move their pages. T-Bank's operations list lives at `/mybank/operations/v8/` today,
 * reached by a redirect from `/mybank/operations/` and carrying a tracking query. An exact
 * match against the address the connector navigated to made it report that the bank "did not
 * stay on the operations page" -- on every run, manual and unattended alike. The page is
 * wherever the bank puts it under that prefix; a sibling such as `/mybank/operations-settings`
 * is not it.
 */
export function isPathUnder(pathname: string, base: string): boolean {
  const root = base.replace(/\/+$/, "");
  if (!root) return true;
  return pathname === root || pathname.startsWith(`${root}/`);
}
