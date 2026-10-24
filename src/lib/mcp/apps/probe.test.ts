import { describe, expect, it, vi } from "vitest";
import { MCP_APP_MIME_TYPE, PROBE_RESOURCE_URI, registerAppProbe } from "./probe";

type Registered = { config: Record<string, unknown>; handler: (...args: unknown[]) => unknown };

function register() {
  const tools = new Map<string, Registered>();
  const resources = new Map<string, Registered & { uri: string }>();
  registerAppProbe({
    registerTool: vi.fn((name: string, config: Record<string, unknown>, handler) => {
      tools.set(name, { config, handler });
      return {} as never;
    }),
    registerResource: vi.fn(
      (name: string, uri: string, config: Record<string, unknown>, handler) => {
        resources.set(name, { uri, config, handler });
        return {} as never;
      },
    ),
  } as never);
  return { tools, resources };
}

describe("registerAppProbe", () => {
  it("links the tool to its card in both _meta forms a client may read", () => {
    const tool = register().tools.get("show_app_probe")!;

    expect(tool.config._meta).toEqual({
      ui: { resourceUri: PROBE_RESOURCE_URI },
      "ui/resourceUri": PROBE_RESOURCE_URI,
    });
    expect(tool.config.annotations).toMatchObject({ readOnlyHint: true });
  });

  it("serves the card as an MCP App page that calls only the read-only list_persons", async () => {
    const resource = register().resources.get("orbit-app-probe")!;
    const result = (await resource.handler(new URL(PROBE_RESOURCE_URI))) as {
      contents: Array<{ uri: string; mimeType: string; text: string }>;
    };

    expect(resource.uri).toBe(PROBE_RESOURCE_URI);
    expect(resource.config.mimeType).toBe(MCP_APP_MIME_TYPE);
    expect(result.contents[0]).toMatchObject({
      uri: PROBE_RESOURCE_URI,
      mimeType: MCP_APP_MIME_TYPE,
    });
    expect(result.contents[0].text).toContain("Карточка Orbit работает");
    expect(result.contents[0].text).toContain('name: "list_persons"');
    expect(result.contents[0].text.match(/name: "/g)).toHaveLength(2);
    expect(result.contents[0].text).toContain("result.isError");
  });
});
