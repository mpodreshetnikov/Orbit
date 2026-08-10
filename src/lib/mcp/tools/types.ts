import type { McpServer } from "@modelcontextprotocol/server";

/**
 * The slice of `McpServer` the tool modules use.
 *
 * Narrowing to just `registerTool` keeps the registration functions trivially
 * testable: a unit test can pass `{ registerTool: vi.fn() }` and assert on tool
 * names, descriptions and annotations without standing up a real server.
 */
export type McpToolServer = Pick<McpServer, "registerTool">;
