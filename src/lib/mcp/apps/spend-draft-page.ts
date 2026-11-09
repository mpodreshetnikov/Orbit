/**
 * Spend draft card: lays out the `spend_draft` view from propose_spend / propose_spend_edit.
 * Values go in through textContent. Confirm calls confirm_spend_draft; Decline writes nothing.
 */
export const SPEND_DRAFT_HTML = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root {
    color-scheme: light dark;
    --color-background-primary: light-dark(#ffffff, #1f1f1e);
    --color-background-secondary: light-dark(#f5f4ef, #2a2a28);
    --color-background-inverse: light-dark(#1f1e1d, #f5f4ef);
    --color-text-primary: light-dark(#1f1e1d, #f5f4ef);
    --color-text-secondary: light-dark(#6b6a66, #a6a39a);
    --color-text-tertiary: light-dark(#8f8d86, #7d7a72);
    --color-text-inverse: light-dark(#ffffff, #1f1e1d);
    --color-text-success: light-dark(#2f7d32, #7cc47f);
    --color-text-danger: light-dark(#b3261e, #f2a29d);
    --color-border-primary: light-dark(rgba(31,30,29,.14), rgba(245,244,239,.14));
    --color-border-secondary: light-dark(rgba(31,30,29,.08), rgba(245,244,239,.08));
    --font-sans: system-ui, -apple-system, "Segoe UI", sans-serif;
    --border-radius-lg: 14px;
    --border-radius-md: 10px;
    --border-radius-full: 999px;
  }
  html, body { margin: 0; background: transparent; }
  body { font: 14px/1.45 var(--font-sans); color: var(--color-text-primary); -webkit-font-smoothing: antialiased; }
  .page { padding: 4px 2px 6px; }
  .card {
    background: var(--color-background-primary);
    border: 1px solid var(--color-border-primary);
    border-radius: var(--border-radius-lg);
    padding: 16px;
  }
  .brand { font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: var(--color-text-tertiary); font-weight: 600; }
  .chip { font-size: 12px; padding: 2px 9px; border-radius: var(--border-radius-full); background: var(--color-background-secondary); color: var(--color-text-secondary); }
  .eyebrow { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  h1 { margin: 8px 0 2px; font-size: 17px; line-height: 1.3; font-weight: 600; }
  .meta { color: var(--color-text-secondary); font-size: 13px; }
  .amount { margin-top: 10px; font-size: 22px; font-weight: 600; font-variant-numeric: tabular-nums; }
  .comment { margin: 8px 0 0; color: var(--color-text-secondary); font-size: 13px; }
  section { margin-top: 16px; }
  h2 { margin: 0 0 6px; font-size: 13px; font-weight: 600; padding-bottom: 6px; border-bottom: 1px solid var(--color-border-primary); }
  .row { display: flex; justify-content: space-between; gap: 12px; padding: 8px 0; border-bottom: 1px solid var(--color-border-secondary); }
  .row:last-child { border-bottom: 0; }
  .row .sub { font-size: 12px; color: var(--color-text-tertiary); margin-top: 1px; }
  .row .end { text-align: right; flex-shrink: 0; font-variant-numeric: tabular-nums; }
  .footer { margin-top: 18px; }
  .actions { display: flex; gap: 8px; }
  button.action { flex: 1; min-height: 44px; padding: 10px 14px; border-radius: var(--border-radius-md); font: inherit; font-weight: 600; cursor: pointer; }
  button.approve { border: 0; background: var(--color-background-inverse); color: var(--color-text-inverse); flex: 1.4; }
  button.decline { border: 1px solid var(--color-border-primary); background: transparent; color: var(--color-text-primary); }
  button.action:disabled { opacity: .5; cursor: default; }
  .result { padding: 12px 14px; border-radius: var(--border-radius-md); background: var(--color-background-secondary); }
  .result.ok strong { color: var(--color-text-success); }
  .result.bad strong { color: var(--color-text-danger); }
  .result p { margin: 4px 0 0; color: var(--color-text-secondary); font-size: 13px; }
  .placeholder { color: var(--color-text-secondary); padding: 8px 0; }
</style>
</head>
<body>
<div class="page" id="page"><div class="card" id="card"><p class="placeholder">Загружаем черновик…</p></div></div>
<script>
  var nextId = 1;
  var pending = {};
  var draft = null;
  var decision = null;
  var busy = null;

  function send(message) { window.parent.postMessage(message, "*"); }
  function request(method, params, timeoutMs, onLate) {
    var id = nextId++;
    send({ jsonrpc: "2.0", id: id, method: method, params: params });
    return new Promise(function (resolve, reject) {
      pending[id] = { settled: false, resolve: resolve, reject: reject, onLate: onLate };
      setTimeout(function () {
        var entry = pending[id];
        if (entry && !entry.settled) {
          entry.settled = true;
          // Mark timeouts: catch must keep confirm in-flight; a plain JSON-RPC reject is final.
          var timedOut = new Error("нет ответа за " + Math.round(timeoutMs / 1000) + " с");
          timedOut.timedOut = true;
          reject(timedOut);
        }
      }, timeoutMs);
    });
  }
  window.addEventListener("message", function (event) {
    var data = event.data;
    if (!data || data.jsonrpc !== "2.0") return;
    if (data.id !== undefined && !data.method) {
      var entry = pending[data.id];
      if (!entry) return;
      delete pending[data.id];
      if (entry.settled) { if (entry.onLate) entry.onLate(data); return; }
      entry.settled = true;
      if (data.error) entry.reject(new Error(data.error.message || "ошибка"));
      else entry.resolve(data.result);
      return;
    }
    if (data.method === "ui/notifications/tool-result") {
      takeResult(data.params);
    } else if (data.id !== undefined) {
      if (data.method === "ui/resource-teardown" || data.method === "ping") {
        send({ jsonrpc: "2.0", id: data.id, result: {} });
      } else {
        send({ jsonrpc: "2.0", id: data.id, error: { code: -32601, message: "Method not found" } });
      }
    }
  });

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }
  function resultText(result) {
    var block = result && result.content && result.content[0];
    return block && block.text ? block.text : "";
  }
  function takeResult(result) {
    var view = result && result.structuredContent && result.structuredContent.spend_draft;
    if (view) { draft = view; if (busy !== "confirm") decision = null; }
    else if (result && result.isError) {
      decision = { kind: "error", message: resultText(result) };
    }
    render();
  }

  function tellModel(textValue) {
    request("ui/update-model-context", { content: [{ type: "text", text: textValue }] }, 10000).catch(function () {});
  }
  function tellChat(textValue) {
    request("ui/message", { role: "user", content: [{ type: "text", text: textValue }] }, 10000).catch(function () {});
  }

  function render() {
    var card = document.getElementById("card");
    card.textContent = "";
    if (decision && decision.kind === "confirmed") {
      card.appendChild(resultBox("ok", "Сохранено", decision.message || "Трата записана."));
      return;
    }
    if (decision && decision.kind === "declined") {
      card.appendChild(resultBox("bad", "Отклонено", "Ничего не записано."));
      return;
    }
    if (decision && decision.kind === "waiting") {
      // Confirm stays disabled (busy) so a late commit cannot be duplicated by a second click.
      card.appendChild(resultBox("", "Ещё сохраняем…", decision.message || "Ждём ответ сервера. Не нажимайте ещё раз."));
      if (draft) card.appendChild(draftBody(draft));
      return;
    }
    if (decision && decision.kind === "error") {
      card.appendChild(resultBox("bad", "Ошибка", decision.message || "Не удалось."));
      if (draft) card.appendChild(draftBody(draft));
      return;
    }
    if (!draft) {
      card.appendChild(el("p", "placeholder", "Загружаем черновик…"));
      return;
    }
    card.appendChild(draftBody(draft));
  }

  function resultBox(kind, title, body) {
    var box = el("div", "result " + kind);
    box.appendChild(el("strong", null, title));
    box.appendChild(el("p", null, body));
    return box;
  }

  function draftBody(view) {
    var wrap = document.createDocumentFragment();
    var eye = el("div", "eyebrow");
    eye.appendChild(el("div", "brand", "Orbit · деньги"));
    eye.appendChild(el("span", "chip", view.mode === "edit" ? "правка" : "новая"));
    wrap.appendChild(eye);
    wrap.appendChild(el("h1", null, view.merchant_name || (view.mode === "edit" ? "Правка траты" : "Новая трата")));
    wrap.appendChild(el("div", "meta", [view.person_name, view.type_label, view.posted_at_label, view.account_label].filter(Boolean).join(" · ")));
    wrap.appendChild(el("div", "amount", view.amount_label));
    if (view.comment) wrap.appendChild(el("p", "comment", view.comment));
    if (view.lines && view.lines.length) {
      var section = el("section");
      section.appendChild(el("h2", null, "Строки"));
      view.lines.forEach(function (line) {
        var row = el("div", "row");
        var main = el("div", "main");
        main.appendChild(el("div", null, line.title));
        if (line.category_label) main.appendChild(el("div", "sub", line.category_label));
        row.appendChild(main);
        row.appendChild(el("div", "end", line.amount_label));
        section.appendChild(row);
      });
      wrap.appendChild(section);
    }
    var footer = el("div", "footer");
    var actions = el("div", "actions");
    var confirmBtn = el("button", "action approve", busy === "confirm" ? "Сохраняем…" : "Подтвердить");
    confirmBtn.disabled = Boolean(busy);
    confirmBtn.addEventListener("click", function () { runConfirm(); });
    var declineBtn = el("button", "action decline", "Отклонить");
    declineBtn.disabled = Boolean(busy);
    declineBtn.addEventListener("click", function () { runDecline(); });
    actions.appendChild(confirmBtn);
    actions.appendChild(declineBtn);
    footer.appendChild(actions);
    wrap.appendChild(footer);
    return wrap;
  }

  function runConfirm() {
    if (!draft || busy) return;
    busy = "confirm";
    decision = null;
    render();
    request("tools/call", {
      name: "confirm_spend_draft",
      arguments: { person_id: draft.person_id, mode: draft.mode, draft: draft.input }
    }, 60000, function (late) {
      // Late after timeout: reconcile result or definitive JSON-RPC error.
      if (!late) return;
      if (late.error) {
        finishConfirm({
          isError: true,
          content: [{ type: "text", text: (late.error && late.error.message) || "ошибка" }]
        });
      } else if (late.result) {
        finishConfirm(late.result);
      }
    }).then(function (result) {
      finishConfirm(result);
    }).catch(function (err) {
      if (err && err.timedOut) {
        // Indeterminate: the request may still commit. Keep Confirm disabled until late reconcile.
        decision = {
          kind: "waiting",
          message: (err.message || String(err)) + " Ждём, не нажимайте Подтвердить снова."
        };
        render();
        return;
      }
      // Definitive RPC reject: pending is gone, nothing will arrive late — show error and unlock.
      finishConfirm({
        isError: true,
        content: [{ type: "text", text: (err && err.message) || String(err) }]
      });
    });
  }

  function finishConfirm(result) {
    if (decision && decision.kind === "confirmed") return;
    busy = null;
    if (result && result.isError) {
      decision = { kind: "error", message: resultText(result) || "Не удалось сохранить." };
      render();
      return;
    }
    decision = { kind: "confirmed", message: resultText(result) || "Трата записана." };
    var label = draft && draft.merchant_name ? draft.merchant_name : "трату";
    tellModel("The owner confirmed the spend draft \\"" + label + "\\" on the Orbit card; it is saved. Do not call confirm_spend_draft again for this draft.");
    tellChat("Подтвердил трату «" + label + "».");
    render();
  }

  function runDecline() {
    if (!draft || busy) return;
    busy = "decline";
    render();
    decision = { kind: "declined" };
    busy = null;
    var label = draft.merchant_name || "трату";
    tellModel("The owner declined the spend draft \\"" + label + "\\" on the Orbit card; nothing was saved. Do not confirm it.");
    tellChat("Отклонил трату «" + label + "».");
    render();
  }

  request("ui/initialize", {
    protocolVersion: "2026-01-26",
    appInfo: { name: "orbit-spend-draft", version: "1.0.0" },
    appCapabilities: { availableDisplayModes: ["inline", "fullscreen"] }
  }, 10000).then(function (result) {
    result = result || {};
    send({ jsonrpc: "2.0", method: "ui/notifications/initialized", params: {} });
    if (result.hostContext) { /* host may restyle; draft arrives via tool-result */ }
  }, function () {
    document.getElementById("card").textContent = "";
    document.getElementById("card").appendChild(el("p", "placeholder", "Карточка не смогла связаться с Claude. Трату можно внести в Orbit."));
  });
</script>
</body>
</html>
`;
