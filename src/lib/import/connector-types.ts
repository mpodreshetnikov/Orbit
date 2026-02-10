/**
 * Import connector registry and types.
 * Connectors are registered here; the UI uses the registry to list sources and run parse().
 */

import type { MoneyImportConnector } from "@/types";

const connectors: MoneyImportConnector[] = [];

export function registerConnector(connector: MoneyImportConnector): void {
  if (connectors.some((c) => c.sourceId === connector.sourceId)) return;
  connectors.push(connector);
}

export function getConnectors(): MoneyImportConnector[] {
  return [...connectors];
}

export function getConnector(sourceId: string): MoneyImportConnector | undefined {
  return connectors.find((c) => c.sourceId === sourceId);
}
