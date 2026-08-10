import { registerCatalogTools } from "./catalogs";
import { registerCheckupTools } from "./checkups";
import { registerMeasurementTools } from "./measurements";
import { registerMedicationTools } from "./medications";
import { registerPersonTools } from "./persons";
import { registerRecordTools } from "./records";
import type { McpToolServer } from "./types";

/** Registers the full Health tool surface on an MCP server instance. */
export function registerHealthTools(server: McpToolServer): void {
  registerPersonTools(server);
  registerMeasurementTools(server);
  registerRecordTools(server);
  registerCheckupTools(server);
  registerCatalogTools(server);
  registerMedicationTools(server);
}
