/**
 * What a person reads of why an import failed.
 *
 * The connectors append `diagnostics={...}` to their errors so the extension's console and the
 * batch keep the page the run was on. That JSON is for whoever debugs the connector, and on the
 * import page and the report it read as a broken screen (2026-10-28). The sentence before it is
 * the reason; the rest is cut here, where every screen reads it, and stays in the stored value.
 */
export function readableImportFailure(message: string | null | undefined): string | null {
  if (typeof message !== "string") return null;
  const marker = message.indexOf("diagnostics=");
  const reason = (marker >= 0 ? message.slice(0, marker) : message).trim().replace(/[,;:]$/, "");
  return reason.trim() || null;
}
