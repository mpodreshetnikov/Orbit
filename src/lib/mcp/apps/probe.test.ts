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

async function probeHtml() {
  const resource = register().resources.get("orbit-app-probe")!;
  const result = (await resource.handler(new URL(PROBE_RESOURCE_URI))) as {
    contents: Array<{ uri: string; mimeType: string; text: string }>;
  };
  return { resource, content: result.contents[0] };
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

  it("serves the card as an MCP App page whose only server call is the card-only ping", async () => {
    const { resource, content } = await probeHtml();

    expect(resource.uri).toBe(PROBE_RESOURCE_URI);
    expect(resource.config.mimeType).toBe(MCP_APP_MIME_TYPE);
    expect(content).toMatchObject({ uri: PROBE_RESOURCE_URI, mimeType: MCP_APP_MIME_TYPE });
    expect(content.text).toContain("Карточка Orbit работает");
    expect(content.text.match(/request\("tools\/call", \{ name: "[a-z_]+"/g)).toEqual([
      'request("tools/call", { name: "probe_ping"',
    ]);
    expect(content.text).toContain("result.isError");
  });

  it("offers the ping to the card only, and it reads nothing", async () => {
    const ping = register().tools.get("probe_ping")!;

    expect(ping.config._meta).toEqual({ ui: { visibility: ["app"] } });
    expect(ping.config.annotations).toMatchObject({ readOnlyHint: true });
    expect(await ping.handler({}, {})).toMatchObject({ structuredContent: { pong: true } });
  });

  it("reports its height without scroll or frame stretch, and clears the full-screen header", async () => {
    const { content } = await probeHtml();
    const html = content.text;

    expect(html).toContain('method: "ui/notifications/size-changed"');
    expect(html).toContain("document.documentElement.getBoundingClientRect().height");
    expect(html).not.toContain(".scrollHeight");
    expect(html).toContain("new ResizeObserver(reportSize)");
    expect(html).toContain('availableDisplayModes: ["inline", "fullscreen"]');
    expect(html).toContain('request("ui/request-display-mode", { mode: wanted }');
    expect(html).toContain("hostContext.safeAreaInsets");
  });

  it("can fall back to writing into the chat", async () => {
    const { content } = await probeHtml();

    expect(content.text).toContain('request("ui/message", {');
    expect(content.text).toContain('role: "user"');
  });
});
