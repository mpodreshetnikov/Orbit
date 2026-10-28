import { registerCatalogTools } from "./catalogs";
import { registerCheckupTools } from "./checkups";
import { registerDocumentTools } from "./documents";
import { registerMeasurementTools } from "./measurements";
import { registerMedicationTools } from "./medications";
import { registerMoneyTools } from "./money";
import { registerPersonTools } from "./persons";
import { registerRecordTools } from "./records";
import { withStrictInputs } from "./strict";
import type { McpToolServer } from "./types";

/** Registers the full tool surface -- Health, and the read-only money ledger -- on an MCP server instance. */
export function registerHealthTools(target: McpToolServer): void {
  const server = withStrictInputs(target);
  registerPersonTools(server);
  registerMeasurementTools(server);
  registerRecordTools(server);
  registerDocumentTools(server);
  registerCheckupTools(server);
  registerCatalogTools(server);
  registerMedicationTools(server);
  registerMoneyTools(server);
}
