import { MCP_SCOPE_WRITE } from "../config";
import type { ToolOptions } from "../tool-context";

/**
 * Options every mutating tool passes to its wrapper.
 *
 * The consent screen presents read and write as separate grants, and a client
 * may register for read alone, so write access has to be checked at dispatch
 * time. Without this a read-only token would still be able to write, which
 * would make the consent screen misleading about what it authorized.
 */
export const WRITE_SCOPE: ToolOptions = { requiredScope: MCP_SCOPE_WRITE };
