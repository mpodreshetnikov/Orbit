/**
 * The record draft card's page: one self-contained HTML file, as an MCP App resource must be.
 *
 * It lays out the `draft` view `show_record_draft` returns and never builds markup from it: every
 * value from the document goes in through `textContent`, so nothing a document says can become
 * markup. Approve calls `activate_medical_record` and Decline `decline_record_draft` through the
 * host; both can take longer than a phone's first answer suggests (the probe saw more than 10 s), so
 * the card waits a minute and still shows an answer that arrives later.
 */
export const RECORD_DRAFT_HTML = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  /* Fallbacks for the host's own style variables, which ui/initialize may replace. */
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
    --color-text-warning: light-dark(#9a5b00, #f0b45a);
    --color-background-warning: light-dark(#fdf3e1, #3a2f1c);
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
  .fullscreen .card { border: 0; border-radius: 0; background: transparent; padding: 4px 18px 0; }
  .eyebrow { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .brand { font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: var(--color-text-tertiary); font-weight: 600; }
  .chip { font-size: 12px; padding: 2px 9px; border-radius: var(--border-radius-full); background: var(--color-background-secondary); color: var(--color-text-secondary); white-space: nowrap; }
  .chip.ok { color: var(--color-text-success); }
  .chip.off { color: var(--color-text-tertiary); }
  h1 { margin: 8px 0 2px; font-size: 17px; line-height: 1.3; font-weight: 600; }
  .meta { color: var(--color-text-secondary); font-size: 13px; }
  .summary { margin: 10px 0 0; color: var(--color-text-secondary); }
  section { margin-top: 18px; }
  .section-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; padding-bottom: 6px; border-bottom: 1px solid var(--color-border-primary); }
  h2 { margin: 0; font-size: 13px; font-weight: 600; }
  h2 .count { color: var(--color-text-tertiary); font-weight: 500; margin-left: 4px; }
  .note { font-size: 12px; color: var(--color-text-warning); }
  .row { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; padding: 8px 0; border-bottom: 1px solid var(--color-border-secondary); }
  .row:last-child { border-bottom: 0; }
  .row .main { min-width: 0; overflow-wrap: anywhere; }
  .row .sub { font-size: 12px; color: var(--color-text-tertiary); margin-top: 1px; }
  .row .end { text-align: right; flex-shrink: 0; max-width: 55%; overflow-wrap: anywhere; }
  .value { font-weight: 500; font-variant-numeric: tabular-nums; }
  .value.high, .value.low { color: var(--color-text-warning); }
  .value.critical { color: var(--color-text-danger); }
  .muted { opacity: .55; }
  .tag { display: inline-block; white-space: nowrap; font-size: 11px; padding: 0 6px; margin-left: 6px; border-radius: var(--border-radius-full); background: var(--color-background-secondary); color: var(--color-text-secondary); vertical-align: 1px; }
  .more { margin-top: 4px; padding: 6px 0; border: 0; background: none; color: var(--color-text-secondary); font: inherit; font-size: 13px; cursor: pointer; }
  .warning { margin-top: 16px; padding: 10px 12px; border-radius: var(--border-radius-md); background: var(--color-background-warning); color: var(--color-text-warning); font-size: 13px; }
  .footer { margin-top: 18px; }
  .fullscreen .footer { position: sticky; bottom: 0; margin: 18px -18px 0; padding: 12px 18px 16px; background: var(--color-background-primary); border-top: 1px solid var(--color-border-primary); }
  .actions { display: flex; gap: 8px; }
  button.action { flex: 1; min-height: 44px; padding: 10px 14px; border-radius: var(--border-radius-md); font: inherit; font-weight: 600; cursor: pointer; }
  button.approve { border: 0; background: var(--color-background-inverse); color: var(--color-text-inverse); flex: 1.4; }
  button.decline { border: 1px solid var(--color-border-primary); background: transparent; color: var(--color-text-primary); }
  button.decline.confirm { border-color: var(--color-text-danger); color: var(--color-text-danger); }
  button.action:disabled { opacity: .5; cursor: default; }
  .links { display: flex; justify-content: center; gap: 16px; margin-top: 10px; }
  .link { border: 0; background: none; padding: 4px; font: inherit; font-size: 13px; color: var(--color-text-secondary); text-decoration: underline; text-underline-offset: 3px; cursor: pointer; }
  .result { padding: 12px 14px; border-radius: var(--border-radius-md); background: var(--color-background-secondary); }
  .result strong { display: block; font-weight: 600; }
  .result.ok strong { color: var(--color-text-success); }
  .result.bad strong { color: var(--color-text-danger); }
  .result p { margin: 4px 0 0; color: var(--color-text-secondary); font-size: 13px; }
  .placeholder { color: var(--color-text-secondary); padding: 8px 0; }
</style>
</head>
<body>
<div class="page" id="page"><div class="card" id="card"><p class="placeholder">Загружаем черновик…</p></div></div>
<script>
  var INLINE_ROWS = 4;
  var nextId = 1;
  var pending = {};
  var hostCaps = {};
  var hostContext = {};
  var draft = null;
  var recordId = null;
  var decision = null; // { kind: "approved" | "declined" | "error", ... }
  var busy = null;
  var expanded = false;
  var confirmTimer = null;

  function send(message) { window.parent.postMessage(message, "*"); }
  // A request that outlives its timeout stays pending, so an answer that arrives later still lands.
  function request(method, params, timeoutMs, onLate) {
    var id = nextId++;
    send({ jsonrpc: "2.0", id: id, method: method, params: params });
    return new Promise(function (resolve, reject) {
      pending[id] = { settled: false, resolve: resolve, reject: reject, onLate: onLate };
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
    if (data.method === "ui/notifications/tool-input") {
      var args = data.params && data.params.arguments;
      if (args && args.record_id) recordId = args.record_id;
    } else if (data.method === "ui/notifications/tool-result") {
      takeResult(data.params);
    } else if (data.method === "ui/notifications/host-context-changed") {
      applyContext(data.params);
    } else if (data.id !== undefined) {
      // Requests from the host: teardown and ping need an answer, the rest are not ours.
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
  function formatDate(iso) {
    if (!iso) return null;
    var date = new Date(iso + "T00:00:00");
    if (isNaN(date.getTime())) return iso;
    return date.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
  }
  function plural(n, one, few, many) {
    var mod10 = n % 10, mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return one;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
    return many;
  }

  function takeResult(result) {
    var view = result && result.structuredContent && result.structuredContent.draft;
    if (view) {
      draft = view;
      recordId = view.record_id;
      if (!decision && view.status === "active") decision = { kind: "approved", already: true };
      if (!decision && view.status === "removed") decision = { kind: "declined", already: true };
    } else if (result && result.isError) {
      decision = { kind: "load-error", message: resultText(result) };
    }
    render();
  }

  function isFullscreen() { return hostContext.displayMode === "fullscreen"; }
  function applyContext(update) {
    if (!update) return;
    for (var key in update) hostContext[key] = update[key];
    var styles = hostContext.styles && hostContext.styles.variables;
    if (styles) for (var name in styles) if (styles[name]) document.documentElement.style.setProperty(name, styles[name]);
    if (hostContext.theme) document.documentElement.style.colorScheme = hostContext.theme;
    document.documentElement.className = isFullscreen() ? "fullscreen" : "";
    // In full screen the host draws its own header over the frame; without insets from the host,
    // the card leaves room for it rather than slide under it.
    var insets = hostContext.safeAreaInsets || {};
    var page = document.getElementById("page");
    page.style.paddingTop = (insets.top || (isFullscreen() ? 72 : 4)) + "px";
    page.style.paddingBottom = (insets.bottom || (isFullscreen() ? 0 : 6)) + "px";
    page.style.paddingLeft = 2 + (insets.left || 0) + "px";
    page.style.paddingRight = 2 + (insets.right || 0) + "px";
    if (draft) render();
  }
  function canFullscreen() {
    var modes = hostContext.availableDisplayModes;
    return Array.isArray(modes) && modes.indexOf("fullscreen") >= 0;
  }
  function showAll() {
    if (canFullscreen() && !isFullscreen()) {
      request("ui/request-display-mode", { mode: "fullscreen" }, 10000).then(function (result) {
        applyContext({ displayMode: (result && result.mode) || "fullscreen" });
      }, function () { expanded = true; render(); });
    } else {
      expanded = true;
      render();
    }
  }

  // Inline, what needs a look comes first; full screen keeps the document's order.
  function flaggedFirst(observations) {
    if (isFullscreen() || expanded) return observations;
    var flagged = observations.filter(function (o) { return o.flag || o.critical; });
    return flagged.concat(observations.filter(function (o) { return !(o.flag || o.critical); }));
  }
  function section(title, items, renderItem, note) {
    if (!items.length) return null;
    var node = el("section");
    var head = el("div", "section-head");
    var h2 = el("h2", null, title);
    h2.appendChild(el("span", "count", String(items.length)));
    head.appendChild(h2);
    if (note) head.appendChild(el("span", "note", note));
    node.appendChild(head);
    var limit = isFullscreen() || expanded ? items.length : INLINE_ROWS;
    items.slice(0, limit).forEach(function (item) { node.appendChild(renderItem(item)); });
    if (items.length > limit) {
      var more = el("button", "more", "Показать все " + items.length + " →");
      more.type = "button";
      more.addEventListener("click", showAll);
      node.appendChild(more);
    }
    return node;
  }
  function row(mainText, subText, endNode, dim, tagText) {
    var node = el("div", "row" + (dim ? " muted" : ""));
    var main = el("div", "main");
    var name = el("div", null, mainText);
    if (tagText) name.appendChild(el("span", "tag", tagText));
    main.appendChild(name);
    if (subText) main.appendChild(el("div", "sub", subText));
    node.appendChild(main);
    if (endNode) node.appendChild(endNode);
    return node;
  }

  function render() {
    var card = document.getElementById("card");
    card.textContent = "";
    if (!draft) {
      card.appendChild(el("p", "placeholder", decision && decision.kind === "load-error"
        ? "Не удалось загрузить черновик: " + (decision.message || "без текста")
        : "Загружаем черновик…"));
      return;
    }

    var eyebrow = el("div", "eyebrow");
    eyebrow.appendChild(el("span", "brand", "Orbit · черновик записи"));
    var chip = decision && decision.kind === "approved" ? el("span", "chip ok", "Одобрена")
      : decision && decision.kind === "declined" ? el("span", "chip off", "Отклонена")
      : el("span", "chip", "На проверке");
    eyebrow.appendChild(chip);
    card.appendChild(eyebrow);
    card.appendChild(el("h1", null, draft.title));
    card.appendChild(el("div", "meta", [draft.person_name, draft.type_label, formatDate(draft.record_date)].filter(Boolean).join(" · ")));
    if (draft.summary) card.appendChild(el("p", "summary", draft.summary));

    var flagged = draft.observations.filter(function (o) { return o.flag || o.critical; }).length;
    var parts = [
      section("Анализы", flaggedFirst(draft.observations), function (o) {
        var end = el("div", "end");
        var cls = "value" + (o.critical ? " critical" : o.flag ? " " + o.flag : "");
        end.appendChild(el("div", cls, (o.flag === "high" ? "↑ " : o.flag === "low" ? "↓ " : "") + o.value));
        if (o.ref) end.appendChild(el("div", "sub", o.ref));
        return row(o.name, null, end, !o.recognised, o.recognised ? null : "не распознан");
      }, flagged ? flagged + " вне нормы" : null),
      section("Находки", draft.findings, function (f) {
        var sub = [f.site, f.details].filter(Boolean).join(" · ");
        return row(f.name, sub || null, null, false, f.recognised ? null : "нет в каталоге");
      }),
      section("Диагнозы", draft.conditions, function (c) {
        var end = el("div", "end sub", c.status);
        return row(c.name, [c.code, c.proposed ? "новый диагноз" : null].filter(Boolean).join(" · ") || null, end);
      }),
      section("Закроется при одобрении", draft.closures, function (c) {
        return row(c.name, c.evidence ? "по анализу " + c.evidence : null, el("div", "end sub", "→ разрешён"));
      })
    ];
    parts.forEach(function (part) { if (part) card.appendChild(part); });
    if (!draft.observations.length && !draft.findings.length && !draft.conditions.length && !draft.closures.length) {
      card.appendChild(el("p", "placeholder", "В документе не нашлось ни анализов, ни находок, ни диагнозов."));
    }

    var unrecognised = draft.observations.filter(function (o) { return !o.recognised; }).length;
    if (unrecognised && (!decision || decision.kind === "error")) {
      card.appendChild(el("div", "warning", unrecognised === 1
        ? "1 показатель не распознан каталогом: при одобрении он не попадёт в карту."
        : unrecognised + " " + plural(unrecognised, "показатель не распознан", "показателя не распознаны", "показателей не распознаны") + " каталогом: при одобрении они не попадут в карту."));
    }

    card.appendChild(renderFooter());
  }

  function renderFooter() {
    var footer = el("div", "footer");
    if (decision && (decision.kind === "approved" || decision.kind === "declined")) {
      var box = el("div", decision.kind === "approved" ? "result ok" : "result");
      if (decision.kind === "approved") {
        box.appendChild(el("strong", null, decision.already ? "Запись уже одобрена" : "Одобрено, запись в карте"));
        if (decision.details) box.appendChild(el("p", null, decision.details));
      } else {
        box.appendChild(el("strong", null, decision.already ? "Черновик уже отклонён" : "Отклонено"));
        box.appendChild(el("p", null, "Черновик убран из записей. Вернуть его можно в Orbit, в удалённых записях."));
      }
      footer.appendChild(box);
      footer.appendChild(renderLinks(false));
      return footer;
    }
    if (decision && decision.kind === "error") {
      var error = el("div", "result bad");
      error.appendChild(el("strong", null, "Не получилось"));
      error.appendChild(el("p", null, decision.message));
      error.style.marginBottom = "10px";
      footer.appendChild(error);
    }

    var actions = el("div", "actions");
    var decline = el("button", "action decline" + (confirmTimer ? " confirm" : ""),
      busy === "decline" ? "Отклоняем…" : confirmTimer ? "Да, отклонить" : "Отклонить");
    decline.type = "button";
    var approve = el("button", "action approve", busy === "approve" ? "Одобряем…" : "Одобрить");
    approve.type = "button";
    decline.disabled = approve.disabled = Boolean(busy);
    decline.addEventListener("click", onDecline);
    approve.addEventListener("click", onApprove);
    actions.appendChild(decline);
    actions.appendChild(approve);
    footer.appendChild(actions);
    footer.appendChild(renderLinks(decision && decision.kind === "error"));
    return footer;
  }

  function renderLinks(withChatFallback) {
    var links = el("div", "links");
    if (draft.review_url && hostCaps.openLinks) {
      var open = el("button", "link", "Открыть в Orbit");
      open.type = "button";
      open.addEventListener("click", function () { request("ui/open-link", { url: draft.review_url }, 10000).catch(function () {}); });
      links.appendChild(open);
    }
    if (withChatFallback && hostCaps.message && decision && decision.action) {
      var say = el("button", "link", "Попросить Claude");
      say.type = "button";
      say.addEventListener("click", function () {
        var verb = decision.action === "approve" ? "Одобри" : "Отклони";
        request("ui/message", { role: "user", content: [{ type: "text", text: verb + " черновик записи «" + draft.title + "» (record_id " + draft.record_id + ")." }] }, 30000).catch(function () {});
      });
      links.appendChild(say);
    }
    return links;
  }

  function tellModel(textValue) {
    if (!hostCaps.updateModelContext) return;
    request("ui/update-model-context", { content: [{ type: "text", text: textValue }] }, 10000).catch(function () {});
  }

  function settle(action, result) {
    busy = null;
    if (result && result.isError) {
      decision = { kind: "error", action: action, message: resultText(result) || "сервер ответил ошибкой" };
    } else if (action === "approve") {
      var outcome = (result && result.structuredContent) || {};
      var notes = [];
      if (outcome.droppedUnmatchedObservations) notes.push("Нераспознанных показателей отброшено: " + outcome.droppedUnmatchedObservations + ".");
      if (outcome.proposalsMaterialized) notes.push("Новых или связанных диагнозов: " + outcome.proposalsMaterialized + ".");
      if (outcome.checkupsCompleted) notes.push("Отмечено чекапов: " + outcome.checkupsCompleted + ".");
      if (outcome.closuresLeftPending) notes.push("Закрытий осталось на подтверждении: " + outcome.closuresLeftPending + ".");
      decision = { kind: "approved", details: notes.join(" ") || null };
      tellModel("The owner approved the record draft \\"" + draft.title + "\\" (record_id " + draft.record_id + ") on the Orbit card; it is on the chart now. Do not call activate_medical_record again.");
    } else {
      decision = { kind: "declined" };
      tellModel("The owner declined the record draft \\"" + draft.title + "\\" (record_id " + draft.record_id + ") on the Orbit card; it was set aside. Do not approve it.");
    }
    render();
  }
  function run(action, toolName) {
    busy = action;
    if (decision && decision.kind === "error") decision = null;
    render();
    request("tools/call", { name: toolName, arguments: { record_id: draft.record_id } }, 60000, function (late) {
      settle(action, late.error ? { isError: true, content: [{ type: "text", text: late.error.message }] } : late.result);
    }).then(function (result) {
      settle(action, result);
    }, function (error) {
      busy = null;
      decision = { kind: "error", action: action, message: error.message + ". Если ответ придёт позже, карточка обновится сама." };
      render();
    });
  }
  function onApprove() {
    if (busy) return;
    clearConfirm();
    run("approve", "activate_medical_record");
  }
  function clearConfirm() {
    if (confirmTimer) { clearTimeout(confirmTimer); confirmTimer = null; }
  }
  function onDecline() {
    if (busy) return;
    if (!confirmTimer) {
      confirmTimer = setTimeout(function () { confirmTimer = null; render(); }, 4000);
      render();
      return;
    }
    clearConfirm();
    run("decline", "decline_record_draft");
  }

  // The host sizes the frame from what the card reports. The root element's own box is measured:
  // unlike scrollHeight it is never stretched to the frame, and unlike a bottom coordinate it does
  // not move when the card is scrolled.
  var lastHeight = 0;
  function reportSize() {
    var height = Math.ceil(document.documentElement.getBoundingClientRect().height) + 2;
    if (height === lastHeight) return;
    lastHeight = height;
    send({ jsonrpc: "2.0", method: "ui/notifications/size-changed", params: { height: height } });
  }

  request("ui/initialize", {
    protocolVersion: "2026-01-26",
    appInfo: { name: "orbit-record-draft", version: "1.0.0" },
    appCapabilities: { availableDisplayModes: ["inline", "fullscreen"] }
  }, 10000).then(function (result) {
    result = result || {};
    hostCaps = result.hostCapabilities || {};
    applyContext(result.hostContext);
    send({ jsonrpc: "2.0", method: "ui/notifications/initialized", params: {} });
    reportSize();
    if (window.ResizeObserver) new ResizeObserver(reportSize).observe(document.documentElement);
    // A host that delivers the input but not the result: fetch the draft by the card's own call.
    setTimeout(function () {
      if (draft || !recordId) return;
      request("tools/call", { name: "show_record_draft", arguments: { record_id: recordId } }, 30000, function (late) {
        if (!draft && late.result) takeResult(late.result);
      }).then(takeResult, function () {});
    }, 6000);
  }, function () {
    document.getElementById("card").textContent = "";
    document.getElementById("card").appendChild(el("p", "placeholder", "Карточка не смогла связаться с Claude. Черновик можно открыть в Orbit."));
  });
</script>
</body>
</html>
`;
