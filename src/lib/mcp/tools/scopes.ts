import { MCP_SCOPE_MONEY_READ, MCP_SCOPE_MONEY_WRITE, MCP_SCOPE_READ, MCP_SCOPE_WRITE } from "../config";
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

/** Propose/draft tools that only build a card view (no writes). */
export const READ_SCOPE: ToolOptions = { requiredScope: MCP_SCOPE_READ };

/** Options every money tool passes: the ledger is its own grant, apart from health data. */
export const MONEY_READ_SCOPE: ToolOptions = { requiredScope: MCP_SCOPE_MONEY_READ };

/** Mutating money tools (spend draft confirm): separate from money:read and health:write. */
export const MONEY_WRITE_SCOPE: ToolOptions = { requiredScope: MCP_SCOPE_MONEY_WRITE };
