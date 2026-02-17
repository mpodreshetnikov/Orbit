import type { Connector } from "./types.js";

const registry = new Map<string, Connector>();

export function registerConnector(connector: Connector | null | undefined): void {
  if (!connector?.sourceId) return;
  registry.set(connector.sourceId, connector);
}

export function getConnector(sourceId: string): Connector | null {
  return registry.get(sourceId) ?? null;
}

export function getConnectors(): Connector[] {
  return Array.from(registry.values());
}
