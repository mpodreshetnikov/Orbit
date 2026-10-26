import type { McpServer } from "@modelcontextprotocol/server";

/**
 * A probe for MCP Apps: does this Claude client render a `ui://` card beside a tool call, and can
 * the card call back into this server?
 *
 * It answers the questions T-261024-jpz depends on before a record's draft is shown as a card, and
 * it carries no health data: its one server call is `probe_ping`, which reads nothing, so a client
 * that renders it wrongly exposes nothing.
 */
export const PROBE_RESOURCE_URI = "ui://orbit/probe.html";
export const MCP_APP_MIME_TYPE = "text/html;profile=mcp-app";

export const PROBE_HTML = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  /* Fallbacks for the host's own style variables, which ui/initialize may replace. */
  :root {
    color-scheme: light dark;
    --color-background-primary: light-dark(#ffffff, #1f1f1e);
    --color-background-secondary: light-dark(#f5f4ef, #262624);
    --color-text-primary: light-dark(#1f1e1d, #f5f4ef);
    --color-text-secondary: light-dark(#6b6a66, #a6a39a);
    --color-text-success: light-dark(#2f7d32, #7cc47f);
    --color-text-danger: light-dark(#b3261e, #f2b8b5);
    --color-border-primary: light-dark(rgba(31,30,29,.15), rgba(245,244,239,.15));
    --font-sans: system-ui, -apple-system, "Segoe UI", sans-serif;
    --font-mono: ui-monospace, "SF Mono", Menlo, monospace;
    --border-radius-lg: 12px;
    --border-radius-md: 8px;
  }
  html, body { margin: 0; background: transparent; }
  body { font: 14px/1.45 var(--font-sans); color: var(--color-text-primary); }
  .page { padding: 4px 2px 6px; }
  .card {
    background: var(--color-background-primary);
    border: 1px solid var(--color-border-primary);
    border-radius: var(--border-radius-lg);
    padding: 14px 16px 16px;
  }
  header { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
  h1 { margin: 0; font-size: 15px; font-weight: 600; }
  .stamp { color: var(--color-text-secondary); font-size: 12px; white-space: nowrap; }
  dl { margin: 12px 0 0; display: grid; grid-template-columns: max-content 1fr; gap: 6px 12px; }
  dt { color: var(--color-text-secondary); }
  dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
  .ok { color: var(--color-text-success); }
  .bad { color: var(--color-text-danger); }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
  button {
    flex: 1 1 auto; padding: 9px 12px; font: inherit; font-weight: 500;
    border-radius: var(--border-radius-md); cursor: pointer;
    border: 1px solid var(--color-border-primary);
    background: var(--color-background-secondary); color: var(--color-text-primary);
  }
  button:active { opacity: .7; }
  /* Full screen is the host's own sheet, so the card stops drawing a card inside it. */
  .fullscreen .card { border: 0; border-radius: 0; background: transparent; padding: 8px 18px; }
</style>
</head>
<body>
<div class="page" id="page">
<div class="card">
  <header>
    <h1>Карточка Orbit работает</h1>
    <span class="stamp" id="rendered"></span>
  </header>
  <dl>
    <dt>Связь с Claude</dt><dd id="bridge">ждём ответа…</dd>
    <dt>Клиент умеет</dt><dd id="caps">неизвестно</dd>
    <dt>Режим</dt><dd id="mode">неизвестно</dd>
    <dt>Рамка</dt><dd id="frame">неизвестно</dd>
    <dt>Вызов сервера</dt><dd id="call">не проверялся</dd>
    <dt>Сообщение в чат</dt><dd id="message">не проверялось</dd>
  </dl>
  <div class="actions">
    <button id="ping" type="button">Вызвать сервер</button>
    <button id="expand" type="button">Развернуть</button>
    <button id="say" type="button">Написать в чат</button>
  </div>
</div>
</div>
<script>
  var nextId = 1;
  var pending = {};
  function $(id) { return document.getElementById(id); }
  function show(id, text, tone) {
    $(id).textContent = text;
    $(id).className = tone || "";
  }
  function send(message) { window.parent.postMessage(message, "*"); }
  // A request that outlives its timeout stays pending, so a late answer is still shown with how
  // long it took: a slow host and a host that never answers are different findings.
  function request(method, params, timeoutMs, onLate) {
    var id = nextId++;
    var started = Date.now();
    send({ jsonrpc: "2.0", id: id, method: method, params: params });
    return new Promise(function (resolve, reject) {
      pending[id] = { started: started, settled: false, resolve: resolve, reject: reject, onLate: onLate };
      setTimeout(function () {
        var entry = pending[id];
        if (entry && !entry.settled) {
          entry.settled = true;
          reject(new Error("нет ответа за " + Math.round(timeoutMs / 1000) + " с"));
        }
      }, timeoutMs);
    });
  }
  window.addEventListener("message", function (event) {
    var data = event.data;
    if (!data || data.jsonrpc !== "2.0") return;
    if (data.id !== undefined && pending[data.id]) {
      var entry = pending[data.id];
      delete pending[data.id];
      var seconds = ((Date.now() - entry.started) / 1000).toFixed(1);
      if (entry.settled) {
        if (entry.onLate) entry.onLate(data, seconds);
        return;
      }
      entry.settled = true;
      if (data.error) entry.reject(new Error((data.error.message || "ошибка") + " (" + seconds + " с)"));
      else entry.resolve({ result: data.result, seconds: seconds });
      return;
    }
    if (data.method === "ui/notifications/host-context-changed") applyContext(data.params);
  });

  // Hosts send partial context updates, so each one is merged and everything is drawn afresh.
  var hostContext = {};
  function applyContext(update) {
    if (!update) return;
    for (var key in update) hostContext[key] = update[key];
    var styles = hostContext.styles && hostContext.styles.variables;
    if (styles) for (var name in styles) if (styles[name]) document.documentElement.style.setProperty(name, styles[name]);
    if (hostContext.theme) document.documentElement.style.colorScheme = hostContext.theme;
    var mode = hostContext.displayMode || "inline";
    var modes = Array.isArray(hostContext.availableDisplayModes) ? hostContext.availableDisplayModes.join(", ") : "?";
    show("mode", mode + " (доступно: " + modes + ")");
    $("expand").textContent = mode === "fullscreen" ? "Свернуть" : "Развернуть";
    document.documentElement.className = mode === "fullscreen" ? "fullscreen" : "";
    // In full screen the host draws its own header over the frame; without insets from the host,
    // the card leaves room for it rather than slide under it.
    var insets = hostContext.safeAreaInsets;
    var top = insets && insets.top ? insets.top : mode === "fullscreen" ? 72 : 0;
    var page = $("page");
    page.style.paddingTop = 4 + top + "px";
    page.style.paddingBottom = 6 + (insets && insets.bottom ? insets.bottom : 0) + "px";
    page.style.paddingLeft = 2 + (insets && insets.left ? insets.left : 0) + "px";
    page.style.paddingRight = 2 + (insets && insets.right ? insets.right : 0) + "px";
    var dims = hostContext.containerDimensions;
    var limit = !dims ? "без данных" : dims.height ? "высота " + dims.height : dims.maxHeight ? "до " + dims.maxHeight : "без предела";
    var inset = insets ? "отступы " + [insets.top, insets.right, insets.bottom, insets.left].join("/") : "без отступов";
    frameLine = limit + " · " + inset;
    drawFrame();
  }

  // The host sizes the frame from what the card reports. The root element's own box is measured:
  // unlike scrollHeight it is never stretched to the frame, and unlike a bottom coordinate it does
  // not move when the card is scrolled.
  var frameLine = "без данных";
  var lastHeight = 0;
  function drawFrame() { show("frame", frameLine + (lastHeight ? " · карточка " + lastHeight + " px" : "")); }
  function reportSize() {
    var height = Math.ceil(document.documentElement.getBoundingClientRect().height) + 2;
    if (height === lastHeight) return;
    lastHeight = height;
    drawFrame();
    send({ jsonrpc: "2.0", method: "ui/notifications/size-changed", params: { height: height } });
  }

  $("rendered").textContent = new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  request("ui/initialize", {
    protocolVersion: "2026-01-26",
    appInfo: { name: "orbit-probe", version: "1.2.0" },
    appCapabilities: { availableDisplayModes: ["inline", "fullscreen"] }
  }, 10000).then(function (answer) {
    var result = answer.result || {};
    var host = result.hostInfo ? (result.hostInfo.name + " " + (result.hostInfo.version || "")).trim() : "клиент";
    show("bridge", "есть, " + host, "ok");
    var caps = Object.keys(result.hostCapabilities || {});
    show("caps", caps.length ? caps.join(", ") : "ничего не заявил", caps.indexOf("serverTools") >= 0 ? "" : "bad");
    applyContext(result.hostContext);
    send({ jsonrpc: "2.0", method: "ui/notifications/initialized", params: {} });
    reportSize();
    if (window.ResizeObserver) new ResizeObserver(reportSize).observe(document.documentElement);
  }, function (error) {
    show("bridge", "нет: " + error.message, "bad");
  });

  $("ping").addEventListener("click", function () {
    show("call", "вызываем…");
    request("tools/call", { name: "probe_ping", arguments: {} }, 30000, function (data, seconds) {
      show("call", "ответ пришёл поздно, через " + seconds + " с", "bad");
    }).then(function (answer) {
      // A tool that fails answers with a normal result marked isError, not a JSON-RPC error.
      var result = answer.result;
      if (result && result.isError) {
        var text = result.content && result.content[0] && result.content[0].text;
        show("call", "сервер ответил ошибкой: " + (text || "без текста"), "bad");
        return;
      }
      show("call", "работает, " + answer.seconds + " с", "ok");
    }, function (error) {
      show("call", "не работает: " + error.message, "bad");
    });
  });

  $("expand").addEventListener("click", function () {
    var wanted = hostContext.displayMode === "fullscreen" ? "inline" : "fullscreen";
    request("ui/request-display-mode", { mode: wanted }, 10000).then(function (answer) {
      applyContext({ displayMode: (answer.result && answer.result.mode) || wanted });
    }, function (error) {
      show("mode", "не переключился: " + error.message, "bad");
    });
  });

  // The fallback for approve and decline if the host does not relay tool calls: the card writes
  // the decision into the chat and Claude carries it out.
  $("say").addEventListener("click", function () {
    show("message", "отправляем…");
    request("ui/message", {
      role: "user",
      content: [{ type: "text", text: "Проверка карточки Orbit: эту строку написала кнопка «Написать в чат». Ответь одним словом «получил»." }]
    }, 30000).then(function (answer) {
      show("message", "работает, " + answer.seconds + " с", "ok");
    }, function (error) {
      show("message", "не работает: " + error.message, "bad");
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
            "Ask the user for a screenshot of the card after pressing «Вызвать сервер», then «Развернуть», and to say whether the whole card is visible in both modes. Ask before they press «Написать в чат»: it posts a test line into this chat, which you answer with one word. Do not describe the card as shown unless they confirm it.",
          ].join(" "),
        },
      ],
      structuredContent: { probe: "orbit-app-probe", resource_uri: PROBE_RESOURCE_URI },
    }),
  );

  // Visible to the card only, so it tests whether the host relays a card's tool calls without
  // touching data or being offered to the model.
  server.registerTool(
    "probe_ping",
    {
      title: "Orbit card probe ping",
      description: "Diagnostic only: answers the Orbit card probe's server call. Reads nothing.",
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: { ui: { visibility: ["app"] } },
    },
    async () => ({
      content: [{ type: "text", text: "pong" }],
      structuredContent: { pong: true },
    }),
  );
}
