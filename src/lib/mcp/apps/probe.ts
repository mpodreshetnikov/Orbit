import type { McpServer } from "@modelcontextprotocol/server";

/**
 * A probe for MCP Apps: does this Claude client render a `ui://` card beside a tool call, and can
 * the card call back into this server?
 *
 * It answers the one question T-261024-jpz depends on before a record's draft is shown as a card,
 * and it carries no health data: the card is static apart from a person count it asks for through
 * the read-only `list_persons` tool, so a client that renders it wrongly exposes nothing.
 */
export const PROBE_RESOURCE_URI = "ui://orbit/probe.html";
export const MCP_APP_MIME_TYPE = "text/html;profile=mcp-app";

export const PROBE_HTML = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; font: 14px/1.4 system-ui, -apple-system, sans-serif; }
  .card { margin: 8px; padding: 14px 16px; border-radius: 12px; border: 1px solid rgba(127,127,127,.35); }
  h1 { margin: 0 0 6px; font-size: 16px; }
  p { margin: 4px 0; }
  .muted { opacity: .7; font-size: 12px; }
  button { margin-top: 10px; padding: 8px 14px; border-radius: 8px; border: 0; font: inherit; background: #2563eb; color: #fff; }
  code { font-size: 12px; }
</style>
</head>
<body>
<div class="card">
  <h1>Карточка Orbit работает</h1>
  <p class="muted" id="rendered"></p>
  <p>Связь с Claude: <code id="bridge">ждём ответа…</code></p>
  <p>Результат инструмента: <code id="result">ещё не пришёл</code></p>
  <button id="ping" type="button">Проверить вызов сервера</button>
  <p>Вызов сервера: <code id="call">не проверялся</code></p>
</div>
<script>
  var nextId = 1;
  var pending = {};
  function $(id) { return document.getElementById(id); }
  function send(message) { window.parent.postMessage(message, "*"); }
  function request(method, params) {
    var id = nextId++;
    send({ jsonrpc: "2.0", id: id, method: method, params: params });
    return new Promise(function (resolve, reject) {
      pending[id] = { resolve: resolve, reject: reject };
      setTimeout(function () {
        if (pending[id]) { delete pending[id]; reject(new Error("нет ответа за 10 с")); }
      }, 10000);
    });
  }
  window.addEventListener("message", function (event) {
    var data = event.data;
    if (!data || data.jsonrpc !== "2.0") return;
    if (data.id !== undefined && pending[data.id]) {
      var entry = pending[data.id];
      delete pending[data.id];
      if (data.error) entry.reject(new Error(data.error.message || "ошибка"));
      else entry.resolve(data.result);
      return;
    }
    if (data.method === "ui/notifications/tool-result") {
      $("result").textContent = "пришёл";
    }
  });
  $("rendered").textContent = "Отрисована " + new Date().toLocaleString("ru-RU");
  request("ui/initialize", {
    protocolVersion: "2026-01-26",
    appInfo: { name: "orbit-probe", version: "1.0.0" },
    appCapabilities: {}
  }).then(function (result) {
    var host = result && result.hostInfo ? result.hostInfo.name + " " + (result.hostInfo.version || "") : "клиент";
    $("bridge").textContent = "есть (" + host.trim() + ")";
    send({ jsonrpc: "2.0", method: "ui/notifications/initialized", params: {} });
  }, function (error) {
    $("bridge").textContent = "нет: " + error.message;
  });
  $("ping").addEventListener("click", function () {
    $("call").textContent = "вызываем…";
    request("tools/call", { name: "list_persons", arguments: {} }).then(function (result) {
      // A tool that fails answers with a normal result marked isError, not a JSON-RPC error.
      if (result && result.isError) {
        var text = result.content && result.content[0] && result.content[0].text;
        $("call").textContent = "сервер ответил ошибкой: " + (text || "без текста");
        return;
      }
      var persons = result && result.structuredContent && result.structuredContent.persons;
      $("call").textContent = Array.isArray(persons) ? "работает, людей: " + persons.length : "работает";
    }, function (error) {
      $("call").textContent = "не работает: " + error.message;
    });
  });
</script>
</body>
</html>
`;

export function registerAppProbe(server: Pick<McpServer, "registerTool" | "registerResource">) {
  server.registerResource(
    "orbit-app-probe",
    PROBE_RESOURCE_URI,
    {
      title: "Orbit card probe",
      description: "A static card that checks whether this client renders MCP Apps.",
      mimeType: MCP_APP_MIME_TYPE,
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: MCP_APP_MIME_TYPE, text: PROBE_HTML }],
    }),
  );

  server.registerTool(
    "show_app_probe",
    {
      title: "Show Orbit card probe",
      description:
        "Diagnostic only: shows a small Orbit card in the chat to check whether this Claude client renders interactive cards (MCP Apps). Call it only when the user asks to test the Orbit card. It reads no health data.",
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: {
        ui: { resourceUri: PROBE_RESOURCE_URI },
        "ui/resourceUri": PROBE_RESOURCE_URI,
      },
    },
    async () => ({
      content: [
        {
          type: "text",
          text: [
            "If this client renders MCP Apps, a card titled «Карточка Orbit работает» is shown with this call.",
            "Ask the user what they see: no card; a card whose «Связь с Claude» line says «нет»; or a card whose button «Проверить вызов сервера» reports «работает». Do not describe the card as shown unless they confirm it.",
          ].join(" "),
        },
      ],
      structuredContent: { probe: "orbit-app-probe", resource_uri: PROBE_RESOURCE_URI },
    }),
  );
}
