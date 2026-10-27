/**
 * The record draft card's page: one self-contained HTML file, as an MCP App resource must be.
 *
 * It lays out the `draft` view `show_record_draft` returns and never builds markup from it: every
 * value from the document goes in through `textContent`, so nothing a document says can become
 * markup. Approve calls `activate_medical_record` and Decline `decline_record_draft` through the
 * host; both can take longer than a phone's first answer suggests (the probe saw more than 10 s), so
 * the card waits a minute and still shows an answer that arrives later.
 *
 * An approved record with closures or completions proposed after approval (`has_proposals`) gets
 * the same card in a second mode: only what was proposed, with Confirm (`confirm_record_proposals`)
 * and Decline (`dismiss_record_proposals`) instead (T-261026-y7c). A third mode shows the new
 * checkups `propose_checkup` returns, with Add (`add_proposed_checkups`) and Skip, which writes
 * nothing.
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
  .pages { display: flex; gap: 8px; overflow-x: auto; margin: 12px 0 2px; padding-bottom: 2px; }
  .page-tile { flex: 0 0 auto; width: 64px; height: 84px; border: 1px solid var(--color-border-primary); border-radius: var(--border-radius-md); background: var(--color-background-secondary); overflow: hidden; padding: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; font: inherit; color: var(--color-text-secondary); cursor: pointer; }
  .page-tile:disabled { cursor: default; opacity: .6; }
  .page-tile img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .page-tile .kind { font-size: 11px; font-weight: 600; letter-spacing: .04em; }
  .page-tile .name { font-size: 10px; max-width: 58px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
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
  .position { margin-top: -6px; margin-bottom: 4px; font-size: 12px; color: var(--color-text-tertiary); }
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
  var checkups = null; // the checkup_proposal view, in the card's third mode
  var recordId = null;
  var thenRecordIds = [];
  var decision = null; // { kind: "approved" | "declined" | "confirmed" | "dismissed" | "error", ... }
  var busy = null;
  var expanded = false;
  var confirmTimer = null;
  // Several drafts on one card: [{ record_id, title }], the one shown, and what was decided on each.
  var queue = null;
  var queueIndex = 0;
  var outcomes = [];
  var queueDone = false;

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
      if (args && Array.isArray(args.then_record_ids)) thenRecordIds = args.then_record_ids;
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
    var proposed = result && result.structuredContent && result.structuredContent.checkup_proposal;
    if (proposed) { checkups = proposed; render(); return; }
    var view = result && result.structuredContent && result.structuredContent.draft;
    var listed = result && result.structuredContent && result.structuredContent.queue;
    if (!queue && listed && listed.length > 1) queue = listed;
    if (view) {
      draft = view;
      recordId = view.record_id;
      if (!decision && view.status === "active" && !view.has_proposals) decision = { kind: "approved", already: true };
      if (!decision && view.status === "removed") decision = { kind: "declined", already: true };
      // Decided in Orbit while the card waited: the summary says so rather than count it unseen.
      if (decision && decision.already && inQueue() && !outcomes[queueIndex]) {
        outcomes[queueIndex] = { record_id: view.record_id, title: view.title, kind: "already" };
      }
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
    if (draft || checkups) render();
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
    [].concat(subText || []).forEach(function (line) {
      if (line) main.appendChild(el("div", "sub", line));
    });
    node.appendChild(main);
    if (endNode) node.appendChild(endNode);
    return node;
  }

  function isSettled() {
    return Boolean(decision) && ["approved", "declined", "confirmed", "dismissed"].indexOf(decision.kind) >= 0;
  }
  // An approved record whose proposed closures are waiting, or were just ruled on from this card.
  function isProposal() {
    return Boolean(draft.has_proposals) || Boolean(decision && (decision.kind === "confirmed" || decision.kind === "dismissed"));
  }

  function render() {
    var card = document.getElementById("card");
    card.textContent = "";
    if (checkups) { renderCheckups(card); return; }
    if (!draft) {
      var failed = decision && decision.kind === "load-error";
      card.appendChild(el("p", "placeholder", failed
        ? "Не удалось загрузить черновик: " + (decision.message || "без текста")
        : "Загружаем черновик…"));
      // One failed load must not strand the rest of the queue or the summary of what was decided.
      if (failed && inQueue() && !queueDone) {
        card.appendChild(el("div", "position", (queueIndex + 1) + " из " + queue.length));
        var retry = el("button", "action", "Повторить");
        retry.type = "button";
        retry.addEventListener("click", loadQueued);
        card.appendChild(queueActions(retry));
      }
      return;
    }

    var eyebrow = el("div", "eyebrow");
    var proposal = isProposal();
    eyebrow.appendChild(el("span", "brand", proposal ? "Orbit · сверка записи" : "Orbit · черновик записи"));
    var chip = decision && decision.kind === "approved" ? el("span", "chip ok", "Одобрена")
      : decision && decision.kind === "declined" ? el("span", "chip off", "Отклонена")
      : decision && decision.kind === "confirmed" ? el("span", "chip ok", "Подтверждено")
      : decision && decision.kind === "dismissed" ? el("span", "chip off", "Отклонено")
      : el("span", "chip", proposal ? "Ждёт подтверждения" : "На проверке");
    eyebrow.appendChild(chip);
    card.appendChild(eyebrow);
    if (inQueue()) card.appendChild(el("div", "position", (queueIndex + 1) + " из " + queue.length));
    card.appendChild(el("h1", null, draft.title));
    card.appendChild(el("div", "meta", [draft.person_name, draft.type_label, formatDate(draft.record_date)].filter(Boolean).join(" · ")));
    if (draft.summary) card.appendChild(el("p", "summary", draft.summary));
    var pages = renderPages();
    if (pages) card.appendChild(pages);

    var flagged = draft.observations.filter(function (o) { return o.flag || o.critical; }).length;
    var done = decision && decision.kind === "confirmed" && !decision.partial;
    var closuresTitle = done ? "Закрыто" : proposal ? "Закроется при подтверждении" : "Закроется при одобрении";
    var completionsTitle = done ? "Отмечено выполненным" : proposal ? "Отметится выполненным при подтверждении" : "Отметится выполненным при одобрении";
    var closing = [
      section(closuresTitle, draft.closures, function (c) {
        return row(c.name, c.evidence ? "по анализу " + c.evidence : null, el("div", "end sub", "→ " + c.status));
      }),
      section(completionsTitle, draft.completions || [], function (c) {
        return row(c.title, c.reason || null, el("div", "end sub", formatDate(c.done_at)));
      })
    ];
    // The record itself is already on the chart, so a proposal shows only what it would change.
    var parts = proposal ? closing : [
      section("Анализы", flaggedFirst(draft.observations), function (o) {
        var end = el("div", "end");
        var cls = "value" + (o.critical ? " critical" : o.flag ? " " + o.flag : "");
        end.appendChild(el("div", cls, (o.flag === "high" ? "↑ " : o.flag === "low" ? "↓ " : "") + o.value));
        if (o.ref) end.appendChild(el("div", "sub", o.ref));
        return row(o.name, null, end, !o.recognised, o.recognised ? null : "не распознан");
      }, flagged ? flagged + " вне нормы" : null),
      section("Находки", draft.findings, function (f) {
        var sub = [f.site, f.details].filter(Boolean).join(" · ");
        var lines = [sub, f.description, f.histology ? "Гистология: " + f.histology : null];
        return row(f.name, lines, null, false, f.recognised ? null : "нет в каталоге");
      }),
      section("Диагнозы", draft.conditions, function (c) {
        var end = el("div", "end sub", c.status);
        return row(c.name, [c.code, c.proposed ? "новый диагноз" : null].filter(Boolean).join(" · ") || null, end);
      }),
    ].concat(closing);
    parts.forEach(function (part) { if (part) card.appendChild(part); });
    if (!proposal && !draft.observations.length && !draft.findings.length && !draft.conditions.length && !draft.closures.length && !(draft.completions || []).length) {
      card.appendChild(el("p", "placeholder", "В документе не нашлось ни анализов, ни находок, ни диагнозов."));
    }

    var unrecognised = draft.observations.filter(function (o) { return !o.recognised; }).length;
    if (!proposal && unrecognised && (!decision || decision.kind === "error")) {
      card.appendChild(el("div", "warning", unrecognised === 1
        ? "1 показатель не распознан каталогом: он сохранится в записи, но не попадёт в историю показателей."
        : unrecognised + " " + plural(unrecognised, "показатель не распознан", "показателя не распознаны", "показателей не распознаны") + " каталогом: они сохранятся в записи, но не попадут в историю показателей."));
    }

    card.appendChild(renderFooter());
  }

  function renderFooter() {
    var footer = el("div", "footer");
    if (isSettled()) {
      var box = el("div", decision.kind === "approved" || decision.kind === "confirmed" ? "result ok" : "result");
      if (decision.kind === "confirmed") {
        box.appendChild(el("strong", null, decision.partial ? "Подтверждено частично" : "Подтверждено, в карте"));
        if (decision.details) box.appendChild(el("p", null, decision.details));
      } else if (decision.kind === "dismissed") {
        box.appendChild(el("strong", null, "Отклонено"));
        box.appendChild(el("p", null, "Диагнозы и чекапы остались как были. Запись по-прежнему одобрена."));
      } else if (decision.kind === "approved") {
        box.appendChild(el("strong", null, decision.already ? "Запись уже одобрена" : "Одобрено, запись в карте"));
        if (decision.details) box.appendChild(el("p", null, decision.details));
      } else {
        box.appendChild(el("strong", null, decision.already ? "Черновик уже отклонён" : "Отклонено"));
        box.appendChild(el("p", null, "Черновик убран из записей. Вернуть его можно в Orbit, в удалённых записях."));
      }
      footer.appendChild(box);
      if (inQueue() && !queueDone) footer.appendChild(queueActions());
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

    var proposal = isProposal();
    var actions = el("div", "actions");
    var decline = el("button", "action decline" + (confirmTimer ? " confirm" : ""),
      busy === "decline" || busy === "dismiss" ? "Отклоняем…" : confirmTimer ? "Да, отклонить" : "Отклонить");
    decline.type = "button";
    var approve = el("button", "action approve", busy === "approve" || busy === "confirm"
      ? (proposal ? "Подтверждаем…" : "Одобряем…")
      : (proposal ? "Подтвердить" : "Одобрить"));
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

  // The document's own pages, so the owner can check a value against the original without Claude
  // rendering screenshots. A tap opens the file; a thumbnail the host refuses to load falls back to
  // the page's name.
  function renderPages() {
    var list = draft.pages || [];
    if (!list.length) return null;
    var strip = el("div", "pages");
    list.forEach(function (page, index) {
      var tile = el("button", "page-tile");
      tile.type = "button";
      tile.title = page.name;
      tile.setAttribute("aria-label", "Страница " + (index + 1) + ": " + page.name);
      var label = function () {
        tile.textContent = "";
        tile.appendChild(el("span", "kind", page.mime_type === "application/pdf" ? "PDF" : String(index + 1)));
        tile.appendChild(el("span", "name", page.name));
      };
      if (page.url && page.mime_type.indexOf("image/") === 0) {
        var img = el("img");
        img.alt = page.name;
        img.loading = "lazy";
        img.addEventListener("error", label);
        img.src = page.url;
        tile.appendChild(img);
      } else {
        label();
      }
      if (page.url && hostCaps.openLinks) {
        tile.addEventListener("click", function () { request("ui/open-link", { url: page.url }, 10000).catch(function () {}); });
      } else {
        tile.disabled = true;
      }
      strip.appendChild(tile);
    });
    return strip;
  }

  function renderLinks(withChatFallback) {
    var links = el("div", "links");
    if (draft.review_url && hostCaps.openLinks) {
      var open = el("button", "link", "Открыть в Orbit");
      open.type = "button";
      open.addEventListener("click", function () { request("ui/open-link", { url: draft.review_url }, 10000).catch(function () {}); });
      links.appendChild(open);
    }
    // Only approve can be handed to Claude: decline is the card's alone, so a failed one is retried
    // here or done in Orbit.
    if (withChatFallback && hostCaps.message && decision && decision.action === "approve") {
      var say = el("button", "link", "Попросить Claude");
      say.type = "button";
      say.addEventListener("click", function () {
        tellChat("Одобри черновик записи «" + draft.title + "» (record_id " + draft.record_id + ").");
      });
      links.appendChild(say);
    }
    return links;
  }

  function inQueue() { return Boolean(queue) && queue.length > 1; }
  var OUTCOME_LABELS = { approved: "одобрено", declined: "отклонено", confirmed: "сверка подтверждена", dismissed: "сверка отклонена", already: "уже решено в Orbit" };
  // Each decision reaches the model as it happens; the chat gets one line, when the owner is done
  // with the whole queue, so Claude does not take a turn in the middle of it.
  function noteOutcome(kind) {
    if (!inQueue()) return false;
    outcomes[queueIndex] = { record_id: draft.record_id, title: draft.title, kind: kind };
    if (queueIndex >= queue.length - 1) finishQueue();
    return true;
  }
  function finishQueue() {
    var done = outcomes.filter(Boolean);
    var counts = {};
    done.forEach(function (o) { counts[o.kind] = (counts[o.kind] || 0) + 1; });
    var left = queue.filter(function (q, i) { return !outcomes[i]; });
    tellModel("The owner went through the queued drafts on the Orbit card. " +
      done.map(function (o) { return "\\"" + o.title + "\\" (record_id " + o.record_id + "): " + (o.kind === "already" ? "already decided in Orbit before the card reached it" : o.kind); }).join("; ") + "." +
      (left.length ? " Not reviewed yet: " + left.map(function (q) { return "\\"" + q.title + "\\" (record_id " + q.record_id + ")"; }).join("; ") + "." : ""));
    tellChat("Разобрал записи в карточке: " + Object.keys(counts).map(function (k) { return OUTCOME_LABELS[k] + " " + counts[k]; }).join(", ") +
      (left.length ? ", не смотрел " + left.length : "") + ".");
    queueDone = true;
    render();
  }
  // Закончить is always there, so the last draft ends the queue even if it was decided elsewhere.
  function queueActions(extra) {
    var actions = el("div", "actions");
    actions.style.marginTop = "10px";
    var stop = el("button", "action decline", "Закончить");
    stop.type = "button";
    stop.addEventListener("click", finishQueue);
    actions.appendChild(stop);
    if (extra) actions.appendChild(extra);
    if (queueIndex < queue.length - 1) {
      var next = el("button", "action approve", "Дальше: " + (queueIndex + 2) + " из " + queue.length);
      next.type = "button";
      next.addEventListener("click", nextInQueue);
      actions.appendChild(next);
    }
    return actions;
  }
  function nextInQueue() {
    queueIndex += 1;
    loadQueued();
  }
  function loadQueued() {
    draft = null;
    decision = null;
    expanded = false;
    render();
    var index = queueIndex;
    var id = queue[index].record_id;
    recordId = id;
    request("tools/call", { name: "show_record_draft", arguments: { record_id: id } }, 60000, function (late) {
      if (!draft && index === queueIndex && late.result) takeResult(late.result);
    }).then(function (result) {
      if (index === queueIndex) takeResult(result);
    }, function (error) {
      if (index !== queueIndex) return;
      decision = { kind: "load-error", message: error.message };
      render();
    });
  }

  function tellModel(textValue) {
    if (!hostCaps.updateModelContext) return;
    request("ui/update-model-context", { content: [{ type: "text", text: textValue }] }, 10000).catch(function () {});
  }
  // Model context alone does not start a turn: on 2026-10-26 the owner approved on the card and
  // then had to type "Дальше" before Claude moved on. A short line in the owner's voice does, and
  // it reaches the chat after the context that explains it.
  function tellChat(textValue) {
    if (!hostCaps.message) return;
    leaveFullscreen().then(function () {
      request("ui/message", { role: "user", content: [{ type: "text", text: textValue }] }, 30000).catch(function () {});
    });
  }
  // On the phone a chat message sent from full screen opens the chat in a second sheet over the
  // card (2026-10-27). Back inline first, the reply lands in the chat the owner is already in.
  function leaveFullscreen() {
    if (!isFullscreen()) return Promise.resolve();
    return request("ui/request-display-mode", { mode: "inline" }, 10000).then(function (result) {
      applyContext({ displayMode: (result && result.mode) || "inline" });
    }, function () {});
  }

  function settle(action, result) {
    busy = null;
    if (result && result.isError) {
      decision = { kind: "error", action: action, message: resultText(result) || "сервер ответил ошибкой" };
    } else if (action === "confirm") {
      var confirmed = (result && result.structuredContent) || {};
      var lines = [];
      if (confirmed.mentionsConfirmed) lines.push("Закрыто диагнозов: " + confirmed.mentionsConfirmed + ".");
      if (confirmed.checkupsCompleted) lines.push("Отмечено чекапов: " + confirmed.checkupsCompleted + ".");
      if (confirmed.closuresLeftPending) lines.push("Закрытий осталось на подтверждении: " + confirmed.closuresLeftPending + ".");
      var left = confirmed.closuresLeftPending || 0;
      decision = { kind: "confirmed", partial: left > 0, details: lines.join(" ") || null };
      tellModel("The owner confirmed the proposed closures and checkup completions for \\"" + draft.title + "\\" (record_id " + draft.record_id + ") on the Orbit card: " + (confirmed.mentionsConfirmed || 0) + " closure(s) and " + (confirmed.checkupsCompleted || 0) + " checkup completion(s) are on the chart now." + (left ? " " + left + " closure(s) did NOT reach the chart: the measurement they cite is no longer in range on this record, so they still await confirmation and the condition keeps its status." : ""));
      if (!noteOutcome("confirmed")) tellChat((left ? "Подтвердил сверку частично: " : "Подтвердил сверку: ") + "«" + draft.title + "».");
    } else if (action === "dismiss") {
      decision = { kind: "dismissed" };
      tellModel("The owner declined the proposed closures and checkup completions for \\"" + draft.title + "\\" (record_id " + draft.record_id + ") on the Orbit card; nothing changed. Do not propose them again unless the owner asks.");
      if (!noteOutcome("dismissed")) tellChat("Отклонил сверку: «" + draft.title + "».");
    } else if (action === "approve") {
      var outcome = (result && result.structuredContent) || {};
      var notes = [];
      if (outcome.keptUnmatchedObservations) notes.push("Нераспознанные показатели сохранены в записи, но не в истории: " + outcome.keptUnmatchedObservations + ".");
      if (outcome.proposalsMaterialized) notes.push("Новых или связанных диагнозов: " + outcome.proposalsMaterialized + ".");
      if (outcome.checkupsCompleted) notes.push("Отмечено чекапов: " + outcome.checkupsCompleted + ".");
      if (outcome.closuresLeftPending) notes.push("Закрытий осталось на подтверждении: " + outcome.closuresLeftPending + ".");
      decision = { kind: "approved", details: notes.join(" ") || null };
      tellModel("The owner approved the record draft \\"" + draft.title + "\\" (record_id " + draft.record_id + ") on the Orbit card; it is on the chart now. Do not call activate_medical_record again.");
      if (!noteOutcome("approved")) tellChat("Одобрил запись «" + draft.title + "».");
    } else {
      decision = { kind: "declined" };
      tellModel("The owner declined the record draft \\"" + draft.title + "\\" (record_id " + draft.record_id + ") on the Orbit card; it was set aside. Do not approve it.");
      if (!noteOutcome("declined")) tellChat("Отклонил запись «" + draft.title + "».");
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
    if (isProposal()) run("confirm", "confirm_record_proposals");
    else run("approve", "activate_medical_record");
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
    if (isProposal()) run("dismiss", "dismiss_record_proposals");
    else run("decline", "decline_record_draft");
  }

  function renderCheckups(card) {
    var eyebrow = el("div", "eyebrow");
    eyebrow.appendChild(el("span", "brand", "Orbit · новый чекап"));
    eyebrow.appendChild(decision && decision.kind === "added" ? el("span", "chip ok", "Добавлено")
      : decision && decision.kind === "skipped" ? el("span", "chip off", "Не добавлено")
      : el("span", "chip", "Предложение"));
    card.appendChild(eyebrow);
    // Once added, the card lists what reached the schedule; the rest is named in the result box.
    var items = decision && decision.added
      ? checkups.items.filter(function (c) { return decision.added.indexOf(c.title.trim()) !== -1; })
      : checkups.items;
    var offered = checkups.items;
    card.appendChild(el("h1", null, offered.length === 1 ? offered[0].title : "Новые чекапы: " + offered.length));
    card.appendChild(el("div", "meta", [checkups.person_name, checkups.evidence_label ? "по записи «" + checkups.evidence_label + "»" : null].filter(Boolean).join(" · ")));
    var list = section(decision && decision.kind === "added" ? "В расписании" : "Добавится в расписание", items, function (c) {
      var lines = [c.category_label + " · " + c.schedule_label, c.why, c.condition_name ? "Диагноз: " + c.condition_name : null];
      return row(c.title, lines, el("div", "end sub", "с " + formatDate(c.first_due_at)));
    });
    if (list) card.appendChild(list);

    var footer = el("div", "footer");
    if (decision && (decision.kind === "added" || decision.kind === "skipped")) {
      var box = el("div", decision.kind === "added" ? "result ok" : "result");
      box.appendChild(el("strong", null, decision.kind === "added" ? "Добавлено в расписание" : "Не добавлено"));
      box.appendChild(el("p", null, decision.details || (decision.kind === "added" ? "Напоминания придут, как у остальных чекапов." : "В расписании ничего не изменилось.")));
      footer.appendChild(box);
      card.appendChild(footer);
      return;
    }
    if (decision && decision.kind === "error") {
      var error = el("div", "result bad");
      error.appendChild(el("strong", null, "Не получилось"));
      error.appendChild(el("p", null, decision.message));
      error.style.marginBottom = "10px";
      footer.appendChild(error);
    }
    var actions = el("div", "actions");
    var skip = el("button", "action decline", "Не нужно");
    skip.type = "button";
    var add = el("button", "action approve", busy === "add" ? "Добавляем…" : "Добавить");
    add.type = "button";
    skip.disabled = add.disabled = Boolean(busy);
    skip.addEventListener("click", onSkipCheckups);
    add.addEventListener("click", onAddCheckups);
    actions.appendChild(skip);
    actions.appendChild(add);
    footer.appendChild(actions);
    card.appendChild(footer);
  }
  function checkupTitles() {
    return checkups.items.map(function (c) { return "\\"" + c.title + "\\""; }).join(", ");
  }
  function onSkipCheckups() {
    if (busy) return;
    decision = { kind: "skipped" };
    tellModel("The owner chose not to add the proposed checkup(s) " + checkupTitles() + " on the Orbit card. Do not schedule them.");
    tellChat("Не стал добавлять чекапы.");
    render();
  }
  // The server's reasons are for the model; the owner reads the gist.
  function refusalLabel(reason) {
    if (/^already scheduled/.test(reason)) return "уже есть в расписании";
    if (/^condition_id/.test(reason)) return "диагноз не найден";
    if (/^evidence_record_id/.test(reason)) return "запись не найдена";
    return reason;
  }
  function settleCheckups(result) {
    busy = null;
    if (result && result.isError) {
      decision = { kind: "error", message: resultText(result) || "сервер ответил ошибкой" };
    } else {
      // What reached the schedule is what the server says it added, not what the card offered:
      // the second check can refuse an item, or all of them.
      var outcome = (result && result.structuredContent) || {};
      var added = (outcome.added || []).map(function (a) { return a.title; });
      var refused = outcome.refused || [];
      var refusedText = refused.map(function (r) { return r.title + " (" + refusalLabel(r.reason) + ")"; }).join(", ");
      decision = {
        kind: added.length ? "added" : "skipped",
        added: added,
        details: refused.length ? "Не добавлено: " + refusedText + "." : null
      };
      tellModel(added.length
        ? "The owner pressed Add on the Orbit card; scheduled now: " + added.map(function (t) { return "\\"" + t + "\\""; }).join(", ") + "." +
          (refused.length ? " Not added: " + refused.map(function (r) { return "\\"" + r.title + "\\" (" + r.reason + ")"; }).join(", ") + "; those are NOT scheduled." : "")
        : "The owner pressed Add on the Orbit card, but nothing was scheduled: " + refused.map(function (r) { return "\\"" + r.title + "\\" (" + r.reason + ")"; }).join(", ") + ".");
      tellChat(added.length ? "Добавил в расписание: " + added.join(", ") + "." : "Чекапы не добавились.");
    }
    render();
  }
  function onAddCheckups() {
    if (busy) return;
    busy = "add";
    if (decision && decision.kind === "error") decision = null;
    render();
    var args = {
      person_id: checkups.person_id,
      evidence_record_id: checkups.evidence_record_id,
      checkups: checkups.items.map(function (c) { return c.input; })
    };
    request("tools/call", { name: "add_proposed_checkups", arguments: args }, 60000, function (late) {
      settleCheckups(late.error ? { isError: true, content: [{ type: "text", text: late.error.message }] } : late.result);
    }).then(settleCheckups, function (error) {
      busy = null;
      decision = { kind: "error", message: error.message + ". Если ответ придёт позже, карточка обновится сама." };
      render();
    });
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
      if (draft || !recordId || queueIndex > 0) return;
      var args = thenRecordIds.length ? { record_id: recordId, then_record_ids: thenRecordIds } : { record_id: recordId };
      request("tools/call", { name: "show_record_draft", arguments: args }, 30000, function (late) {
        if (!draft && late.result) takeResult(late.result);
      }).then(takeResult, function () {});
    }, 2000);
  }, function () {
    document.getElementById("card").textContent = "";
    document.getElementById("card").appendChild(el("p", "placeholder", "Карточка не смогла связаться с Claude. Черновик можно открыть в Orbit."));
  });
</script>
</body>
</html>
`;
