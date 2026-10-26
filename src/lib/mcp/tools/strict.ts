import { z } from "zod";
import type { McpToolServer } from "./types";

/**
 * Register tools whose arguments must be exactly the ones they declare.
 *
 * Zod objects drop unknown keys by default, so an argument a tool does not have was accepted and
 * ignored. On 2026-10-26 an agent passed `status` and `include_drafts` to
 * `search_medical_records`, got the default answer, and concluded its drafts did not exist. A
 * refused call names the key it does not know, which is something the agent can act on.
 */
export function withStrictInputs(server: McpToolServer): McpToolServer {
  return {
    registerTool: ((name: string, config: { inputSchema?: unknown }, handler: unknown) =>
      (server.registerTool as (...args: unknown[]) => unknown)(
        name,
        config.inputSchema instanceof z.ZodObject
          ? { ...config, inputSchema: config.inputSchema.strict() }
          : config,
        handler,
      )) as McpToolServer["registerTool"],
  };
}
