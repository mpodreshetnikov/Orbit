import { registerConnector } from "./registry.js";
import type { Connector, ConnectorParseInput, ConnectorParseOutput } from "./types.js";

const OPERATIONS_URL = "https://www.tbank.ru/mybank/operations/";

function isTbankUrl(url: unknown): url is string {
  return typeof url === "string" && /^https:\/\/(?:www\.)?tbank\.ru\//i.test(url);
}

function isOperationsPageUrl(url) {
  if (!isTbankUrl(url)) return false;
  try {
    const path = new URL(url).pathname;
    return path === "/mybank/operations" || path === "/mybank/operations/";
  } catch {
    return false;
  }
}

function waitForTabLoad(tabId: number, timeoutMs = 30000): Promise<void> {
  return new Promise((resolve, reject) => {
    const listener = (updatedTabId: number, changeInfo: { status?: string }) => {
      if (updatedTabId !== tabId) return;
      if (changeInfo.status === "complete") {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("Page load timeout."));
    }, timeoutMs);
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then((tab) => {
      if (tab.status === "complete") {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }).catch(() => {});
  });
}

const connector: Connector = {
  sourceId: "tbank_web",
  displayName: "T-Bank Web",
  async parse({ windowFrom, session }: ConnectorParseInput): Promise<ConnectorParseOutput> {
    const fallbackFrom = new Date(Date.now() - 30 * 86400000).toISOString();
    const normalizedWindowFrom = toIsoString(windowFrom) || toIsoString(session?.last_imported_at) || fallbackFrom;

    const [activeTab] = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true,
    });

    if (!activeTab?.id) {
      throw new Error("No active tab. Open T-Bank in a tab first.");
    }

    if (!activeTab.url || !isTbankUrl(activeTab.url)) {
      throw new Error("Active tab is not a T-Bank page. Open https://www.tbank.ru/ and try again.");
    }

    if (!isOperationsPageUrl(activeTab.url)) {
      await chrome.tabs.update(activeTab.id, { url: OPERATIONS_URL });
      await waitForTabLoad(activeTab.id);
    }

    const injection = await chrome.scripting.executeScript({
      target: { tabId: activeTab.id },
      func: extractOperationsInPage,
      args: [{ windowFromIso: normalizedWindowFrom }],
    });

    const extraction = injection?.[0]?.result;
    if (!extraction || !Array.isArray(extraction.rows)) {
      throw new Error("Unable to extract operations from current page.");
    }

    const defaultAccountId =
      typeof session?.default_account_id === "string" && session.default_account_id.trim()
        ? session.default_account_id.trim()
        : null;

    const rows = (extraction.rows as unknown[])
      .map((row) => normalizeExtractedRow(row, defaultAccountId))
      .filter((r) => r != null) as Record<string, unknown>[];

    return {
      rows,
      windowTo: toIsoString(extraction.window_to) || new Date().toISOString(),
      parsedThroughAt: toIsoString(extraction.parsed_through_at) || normalizedWindowFrom,
      parsedTransactionsCount:
        typeof extraction.parsed_transactions_count === "number"
          ? extraction.parsed_transactions_count
          : rows.length,
    };
  },
};

registerConnector(connector);

export default connector;

function toIsoString(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString();
}

function normalizeExtractedRow(row: unknown, defaultAccountId: string | null): Record<string, unknown> | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  const amount = toFiniteNumber(r.amount);
  const postedAt = toIsoString(r.posted_at);
  if (amount === null || !postedAt) return null;

  const merchantName = normalizeText(r.merchant_name) || "T-Bank operation";
  const lineItems = normalizeLineItems(r.line_items, amount, merchantName);
  const accountHint = normalizeAccountHint(r.account_hint);
  const source = normalizeText(r.source) || "tbank";
  const status = normalizeText(r.status) || "posted";
  const transactionType = normalizeText(r.transaction_type) || (amount >= 0 ? "income" : "expense");

  const rawPayload: Record<string, unknown> = {
    connector_source: "tbank_web",
    ...(r.raw_payload && typeof r.raw_payload === "object" ? r.raw_payload : {}),
    account_hint: accountHint || null,
  };

  return {
    account_id: defaultAccountId,
    card_id: null,
    source,
    external_id: normalizeText(r.external_id),
    posted_at: postedAt,
    amount,
    currency: normalizeText(r.currency) || "RUB",
    transaction_type: transactionType,
    status,
    merchant_name: merchantName,
    mcc: normalizeMcc(r.mcc),
    comment: normalizeText(r.comment),
    is_transfer: Boolean(r.is_transfer),
    transfer_group_id: null,
    raw_payload: rawPayload,
    dedupe_hash: normalizeText(r.dedupe_hash),
    line_items: lineItems,
  };
}

function normalizeLineItems(lineItems: unknown, fallbackAmount: number, fallbackTitle: string): Record<string, unknown>[] {
  if (!Array.isArray(lineItems) || lineItems.length === 0) {
    return [
      {
        title: fallbackTitle,
        amount: fallbackAmount,
        raw_payload: { source: "fallback" },
      },
    ];
  }

  const normalized = lineItems
    .map((lineItem: unknown) => {
      if (!lineItem || typeof lineItem !== "object") return null;
      const li = lineItem as Record<string, unknown>;
      const amount = toFiniteNumber(li.amount);
      if (amount === null) return null;

      return {
        title: normalizeText(li.title) || fallbackTitle,
        amount,
        quantity: toFiniteNumber(li.quantity),
        unit: normalizeText(li.unit),
        raw_payload:
          li.raw_payload && typeof li.raw_payload === "object"
            ? li.raw_payload
            : { source: "line_item" },
      };
    })
    .filter(Boolean) as Record<string, unknown>[];

  return normalized.length > 0
    ? normalized
    : [
        {
          title: fallbackTitle,
          amount: fallbackAmount,
          raw_payload: { source: "fallback" },
        },
      ];
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  return cleaned ? cleaned : null;
}

function normalizeMcc(value: unknown): string | null {
  const text = normalizeText(value);
  if (!text) return null;
  const match = text.match(/\d{3,4}/);
  return match ? match[0] : null;
}

function normalizeAccountHint(value: unknown): string | null {
  const text = normalizeText(value);
  if (!text) return null;
  const digits = text.replace(/\D/g, "");
  if (!digits) return null;
  return digits.slice(-4);
}

interface ExtractInput {
  windowFromIso?: string;
}

function extractOperationsInPage(input: ExtractInput): Promise<{
  rows: Record<string, unknown>[];
  window_to: string;
  parsed_through_at: string;
  parsed_transactions_count: number;
}> {
  const windowFromMs = toMs(input?.windowFromIso) ?? Date.now() - 30 * 86400000;
  const maxPasses = 80;
  const maxIdlePasses = 8;
  const scrollDelayMs = 350;

  const rowByFeedKey = new Map<string, Record<string, unknown>>();
  const rowElementByFeedKey = new Map<string, Element>();
  let newestSeenMs = 0;
  let oldestSeenMs = Number.POSITIVE_INFINITY;

  const selectedOperationId = new URLSearchParams(window.location.search).get("operationId");
  const selectedOperationTimeMs = toMs(
    new URLSearchParams(window.location.search).get("operationTime")
  );

  return run();

  async function run() {
    let idlePasses = 0;

    for (let pass = 0; pass < maxPasses; pass++) {
      const beforeSize = rowByFeedKey.size;
      const parsedRows = parseFeedRows();
      parsedRows.forEach((row) => {
        rowByFeedKey.set(row.feed_row_key as string, row);
        const postedMs = toMs(row.posted_at);
        if (postedMs !== null) {
          newestSeenMs = Math.max(newestSeenMs, postedMs);
          oldestSeenMs = Math.min(oldestSeenMs, postedMs);
        }
      });

      if (rowByFeedKey.size === beforeSize) {
        idlePasses += 1;
      } else {
        idlePasses = 0;
      }

      if (Number.isFinite(oldestSeenMs) && oldestSeenMs <= windowFromMs) {
        break;
      }

      if (idlePasses >= maxIdlePasses) {
        break;
      }

      scrollForMore();
      await wait(scrollDelayMs);
    }

    const rows = Array.from(rowByFeedKey.values());
    await enrichRowsWithDetails(rows, rowElementByFeedKey);
    mergeSelectedOperationDetail(rows, selectedOperationId, selectedOperationTimeMs);

    rows.forEach((row) => {
      const postedMs = toMs(row.posted_at);
      if (postedMs !== null) {
        newestSeenMs = Math.max(newestSeenMs, postedMs);
        oldestSeenMs = Math.min(oldestSeenMs, postedMs);
      }
      row.dedupe_hash = buildDedupeHash(row);
    });

    const uniqueRows = dedupeRows(rows);
    const filteredRows = uniqueRows
      .filter((row) => {
        const postedMs = toMs(row.posted_at);
        return postedMs !== null && postedMs >= windowFromMs;
      })
      .sort((a, b) => {
        const aMs = toMs(a.posted_at) ?? 0;
        const bMs = toMs(b.posted_at) ?? 0;
        return bMs - aMs;
      });

    const parsedThroughAt = Number.isFinite(oldestSeenMs)
      ? new Date(oldestSeenMs).toISOString()
      : new Date(windowFromMs).toISOString();
    const windowTo = newestSeenMs > 0 ? new Date(newestSeenMs).toISOString() : new Date().toISOString();

    return {
      rows: filteredRows,
      window_to: windowTo,
      parsed_through_at: parsedThroughAt,
      parsed_transactions_count: filteredRows.length,
    };
  }

  function parseFeedRows() {
    const nodes = Array.from(
      document.querySelectorAll(
        '[data-qa-type="atom-operations-feed-header"], [data-qa-type="atom-operations-feed-operation-root"]'
      )
    );

    // Virtualized list: items are position:absolute with top:Npx; sort by vertical position
    sortNodesByPosition(nodes);

    const rows: Record<string, unknown>[] = [];
    let currentDate: Date | null = null;
    let currentLabel: string | null = null;

    for (const node of Array.from(nodes)) {
      const qaType = node.getAttribute("data-qa-type");
      if (qaType === "atom-operations-feed-header") {
        const parsed = parseHeaderDate(node);
        if (parsed) {
          currentDate = parsed.date;
          currentLabel = parsed.label;
        }
        continue;
      }

      const row = parseOperationNode(node, currentDate, currentLabel);
      if (row) {
        rows.push(row as Record<string, unknown>);
        rowElementByFeedKey.set((row as Record<string, unknown>).feed_row_key as string, node);
      }
    }

    return rows;
  }

  function sortNodesByPosition(nodes: Element[]): void {
    nodes.sort((a: Element, b: Element) => {
      const topA = getNodeTop(a);
      const topB = getNodeTop(b);
      return topA - topB;
    });
  }

  function getNodeTop(node: Element): number {
    const parent = node.parentElement;
    if (parent && parent.style && parent.style.position === "absolute" && parent.style.top) {
      const match = parent.style.top.match(/^(-?\d+(?:\.\d+)?)/);
      if (match) return Number(match[1]);
    }
    const rect = node.getBoundingClientRect();
    return rect.top + (window.scrollY || window.pageYOffset);
  }

  function parseOperationNode(node: Element, currentDate: Date | null, headerLabel: string | null): Record<string, unknown> | null {
    const title = clean(node.querySelector('[data-qa-type="atom-operations-feed-operation-title"]')?.textContent);
    const amountEl = node.querySelector('[data-qa-type="atom-operations-feed-operation-amount"]');
    let amountText = clean(amountEl?.textContent);
    if (!amountText && amountEl) {
      const sensitive = amountEl.closest('[data-qa-type="atom-sensitive"]');
      amountText = clean(sensitive?.textContent);
    }
    const amountInfo = parseAmount(amountText);

    if (!title || !amountInfo) return null;

    const subtitle = clean(node.querySelector('[data-qa-type="atom-operations-feed-operation-subtitle"]')?.textContent);
    const description = clean(
      node.querySelector('[data-qa-type="atom-operations-feed-operation-description"]')?.textContent
    );
    const message = clean(
      node.querySelector('[data-qa-type="atom-operations-feed-operation-message"]')?.textContent
    );

    const postedAt = buildPostedAt(node, currentDate);
    if (!postedAt) return null;

    const accountHint = extractLast4([description, message, title].filter(Boolean).join(" "));
    const transferText = [title, subtitle, description].filter(Boolean).join(" ");
    const isTransfer = /перевод|между своими счетами/i.test(transferText);
    const transactionType = isTransfer ? "transfer" : amountInfo.value >= 0 ? "income" : "expense";

    const row = {
      feed_row_key: buildFeedRowKey({
        title,
        amount: amountInfo.value,
        subtitle,
        description,
        message,
        postedAt,
        headerLabel,
      }),
      source: "tbank",
      external_id: null,
      posted_at: postedAt,
      amount: amountInfo.value,
      currency: amountInfo.currency || "RUB",
      transaction_type: transactionType,
      status: "posted",
      merchant_name: title,
      mcc: null,
      comment: message || null,
      is_transfer: isTransfer,
      account_hint: accountHint,
      line_items: [
        {
          title,
          amount: amountInfo.value,
          quantity: null,
          unit: null,
          raw_payload: {
            source: "feed",
            subtitle: subtitle || null,
            description: description || null,
            message: message || null,
          },
        },
      ],
      raw_payload: {
        source: "tbank_web_feed",
        feed_subtitle: subtitle || null,
        feed_description: description || null,
        feed_message: message || null,
        header_label: headerLabel || null,
        account_hint: accountHint || null,
      },
      dedupe_hash: "",
    } as Record<string, unknown>;

    return row;
  }

  function parseHeaderDate(node: Element): { label: string; date: Date } | null {
    const typography = node.querySelector('[data-qa-type="tui/typography"]');
    const labelCandidate =
      clean(typography?.textContent) ||
      clean(node.textContent);
    if (!labelCandidate) return null;

    const label = labelCandidate.replace(/[+\-−]?\d[\d\s]*(?:[.,]\d+)?\s*[₽р].*$/i, "").trim();
    if (!label) return null;

    const parsedDate = parseRussianDateLabel(label);
    if (!parsedDate) return null;

    return {
      label,
      date: parsedDate,
    };
  }

  function parseRussianDateLabel(label: string | null): Date | null {
    const text = clean(label)?.toLowerCase().replace(/,/g, " ");
    if (!text) return null;

    const today = new Date();
    if (text.startsWith("сегодня")) {
      return new Date(today.getFullYear(), today.getMonth(), today.getDate());
    }
    if (text.startsWith("вчера")) {
      return new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
    }
    if (text.startsWith("позавчера")) {
      return new Date(today.getFullYear(), today.getMonth(), today.getDate() - 2);
    }

    const monthByName = {
      января: 0,
      февраля: 1,
      марта: 2,
      апреля: 3,
      мая: 4,
      июня: 5,
      июля: 6,
      августа: 7,
      сентября: 8,
      октября: 9,
      ноября: 10,
      декабря: 11,
    };

    const match = text.match(/(?:[а-яё]+\s+)?(\d{1,2})\s+([а-яё]+)(?:\s+(\d{4}))?/i);
    if (!match) return null;

    const day = Number(match[1]);
    const monthName = match[2];
    const month = (monthByName as Record<string, number>)[monthName];
    if (!Number.isFinite(day) || month === undefined) return null;

    let year = match[3] ? Number(match[3]) : today.getFullYear();
    let date = new Date(year, month, day);

    if (!match[3]) {
      const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
      if (date.getTime() > tomorrow.getTime()) {
        year -= 1;
        date = new Date(year, month, day);
      }
    }

    return Number.isFinite(date.getTime()) ? date : null;
  }

  function buildPostedAt(node: Element, currentDate: Date | null): string | null {
    const baseDate = currentDate instanceof Date && Number.isFinite(currentDate.getTime())
      ? currentDate
      : new Date();

    const text = clean(node.textContent) || "";
    const timeMatch = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
    const date = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate());
    if (timeMatch) {
      date.setHours(Number(timeMatch[1]), Number(timeMatch[2]), 0, 0);
      return date.toISOString();
    }

    const seedSource = clean(node.textContent) || clean(node.getAttribute("aria-label")) || "fallback";
    const seed = parseInt(hashString(seedSource), 16);
    const hours = 12 + (seed % 12);
    const minutes = Math.floor(seed / 12) % 60;
    const seconds = Math.floor(seed / (12 * 60)) % 60;
    date.setHours(hours % 24, minutes, seconds, 0);
    return date.toISOString();
  }

  function parseAmount(rawText: string | null): { value: number; currency: string } | null {
    const text = clean(rawText);
    if (!text) return null;

    const currency = text.includes("₽") ? "RUB" : "RUB";
    let numeric = text.replace(/−/g, "-").replace(/[^\d,.\-+]/g, "");
    if (!numeric) return null;

    if (numeric.includes(",") && !numeric.includes(".")) {
      const lastComma = numeric.lastIndexOf(",");
      numeric =
        numeric.slice(0, lastComma).replace(/,/g, "") + "." + numeric.slice(lastComma + 1);
    }
    numeric = numeric.replace(/,/g, "");

    if (!numeric || numeric === "-" || numeric === "+") return null;
    const value = Number(numeric);
    if (!Number.isFinite(value)) return null;

    return { value, currency };
  }

  function extractLast4(text: string | null): string | null {
    const normalized = clean(text);
    if (!normalized) return null;
    const matches = normalized.match(/\b\d{4}\b/g);
    if (!matches || matches.length === 0) return null;
    for (const candidate of matches) {
      const num = Number(candidate);
      if (Number.isFinite(num) && (num < 1900 || num > 2099)) {
        return candidate;
      }
    }
    return matches[0];
  }

  async function enrichRowsWithDetails(rows, rowElementMap) {
    const sortedRows = [...rows].sort((a, b) => {
      const aMs = toMs(a.posted_at) ?? 0;
      const bMs = toMs(b.posted_at) ?? 0;
      return bMs - aMs;
    });

    const maxRowsToEnrich = Math.min(sortedRows.length, 120);
    let previousSignature = readCurrentDetailSnapshot(null, null)?.signature ?? null;
    const initialSearch = window.location.search;

    for (let index = 0; index < maxRowsToEnrich; index++) {
      const row = sortedRows[index];
      const element = rowElementMap.get(row.feed_row_key);
      if (!(element instanceof HTMLElement)) continue;

      element.scrollIntoView({ block: "center" });
      await wait(120);
      element.click();

      const hasReceiptBadge = hasReceiptBadgeInRow(element);

      let detail: ReturnType<typeof readCurrentDetailSnapshot> = null;
      let openedPopup: Element | null = null;
      for (let attempt = 0; attempt < 12; attempt++) {
        await wait(200);
        const detailRoot = document.querySelector('[data-qa-type="desktop-pumba-detail-operation"]');
        const urlChanged = window.location.search !== initialSearch;
        if (detailRoot || urlChanged) {
          let hasLineItemsBlock = hasLineItemsSectionInDetail();
          if (hasReceiptBadge && !hasLineItemsBlock) {
            await waitForElement('[data-qa-type="molecule-shopping-list-allButton"]', 5000);
            hasLineItemsBlock = hasLineItemsSectionInDetail();
          }
          if (hasLineItemsBlock) {
            openedPopup = await clickAllLineItemsButtonAndWaitForPopup();
          } else {
            await wait(50);
          }
          detail = readCurrentDetailSnapshot(null, null);
          if (detail && detail.signature && detail.signature !== previousSignature) {
            break;
          }
        }
      }

      if (!detail) continue;
      previousSignature = detail.signature;

      if (!detailMatchesRow(row, detail)) continue;
      applyDetailSnapshotToRow(row, detail);

      if (openedPopup?.isConnected) {
        closeDetailPopupIfOpen();
        await waitForElementRemoved(openedPopup, 3000);
      }
    }
  }

  function mergeSelectedOperationDetail(rows: Record<string, unknown>[], operationId: string | null, operationTimeMs: number | null): void {
    const detail = readCurrentDetailSnapshot(operationId, operationTimeMs);
    if (!detail) return;
    const targetRow = findTargetRowForDetail(rows, detail);
    if (!targetRow) return;
    applyDetailSnapshotToRow(targetRow, detail);
  }

  function readCurrentDetailSnapshot(fallbackOperationId: string | null, fallbackOperationTimeMs: number | null): {
    signature: string;
    external_id: string | null;
    posted_at: string | null;
    title: string | null;
    amount: number | null;
    mcc: string | null;
    account_hint: string | null;
    line_items: Record<string, unknown>[];
  } | null {
    const detailRoot = document.querySelector('[data-qa-type="desktop-pumba-detail-operation"]');
    if (!detailRoot) return null;

    scrollDetailPanelToEnd(detailRoot);

    const searchParams = new URLSearchParams(window.location.search);
    const operationId = searchParams.get("operationId") || fallbackOperationId || null;
    const operationTimeMs = toMs(searchParams.get("operationTime")) ?? fallbackOperationTimeMs;

    const detailTitle =
      clean(
        detailRoot.querySelector('[data-qa-type="atom-avatar-avatarImage"]')?.getAttribute("alt")
      ) || clean(detailRoot.querySelector('[data-qa-type="tui/avatar"] img')?.getAttribute("alt")) ||
      clean(detailRoot.textContent);
    const detailAmount = parseAmount(
      clean(detailRoot.querySelector('[data-qa-type="atom-sensitive"]')?.textContent) ||
      clean(detailRoot.textContent)
    );
    const detailText = clean(detailRoot.textContent) || "";
    const mccMatch = detailText.match(/MCC\s*[:\s]*(\d{3,4})/i) || detailText.match(/\b(\d{4})\s*[–—-]\s*[Mm]erchant/i);
    const accountHint = extractCardLast4FromDetail(detailRoot);

    const lineItems = [
      ...parseShoppingListLineItems(),
      ...parseCashbackLineItems(),
    ];

    const postedAt =
      operationTimeMs !== null ? new Date(operationTimeMs).toISOString() : null;
    const amountValue = detailAmount ? detailAmount.value : null;
    const signature = [
      operationId || "",
      detailTitle || "",
      String(amountValue ?? ""),
      postedAt || "",
      String(lineItems.length),
    ].join("|");

    return {
      signature,
      external_id: operationId,
      posted_at: postedAt,
      title: detailTitle,
      amount: amountValue,
      mcc: mccMatch ? mccMatch[1] : null,
      account_hint: accountHint,
      line_items: lineItems,
    };
  }

  /** Receipt badge is the first tui/badge and has the document/receipt SVG path (M2.75 4.625... h7.876v9.84...). */
  function hasReceiptBadgeInRow(rowElement: Element): boolean {
    const badges = rowElement.querySelectorAll('[data-qa-type="tui/badge"]');
    const firstBadge = badges[0];
    if (!firstBadge) return false;
    const pathEl = firstBadge.querySelector('svg path');
    const d = pathEl?.getAttribute('d') ?? '';
    return /4\.625A2\.618|h7\.876v9\.84/.test(d);
  }

  function hasLineItemsSectionInDetail(): boolean {
    const detailRoot = document.querySelector('[data-qa-type="desktop-pumba-detail-operation"]');
    if (!detailRoot) return false;
    const shoppingSection = detailRoot.querySelector('[data-qa-type="desktop-pumba-shoppings-operation"]');
    if (shoppingSection) return true;
    const allBtn = detailRoot.querySelector('[data-qa-type="molecule-shopping-list-allButton"]');
    return Boolean(allBtn);
  }

  async function clickAllLineItemsButtonAndWaitForPopup(): Promise<Element | null> {
    const allBtn =
      document.querySelector('[data-qa-type="molecule-shopping-list-allButton"] button') ||
      document.querySelector('[data-qa-type="molecule-shopping-list-allButton"] [data-qa-type="uikit/link"]');
    if (allBtn && typeof (allBtn as HTMLElement).click === "function") {
      (allBtn as HTMLElement).click();
      return waitForDetailPopup(2000);
    }
    const shoppingSection = document.querySelector('[data-qa-type="desktop-pumba-shoppings-operation"]');
    if (!shoppingSection) return null;
    const links = shoppingSection.querySelectorAll('button, [role="button"], a, [data-qa-type="uikit/link"]');
    for (const el of Array.from(links)) {
      if (clean(el.textContent) === "Все") {
        if (typeof (el as HTMLElement).click === "function") (el as HTMLElement).click();
        return waitForDetailPopup(2000);
      }
    }
    return null;
  }

  function waitForDetailPopup(timeoutMs: number): Promise<Element | null> {
    const modal = getDetailPopupElement();
    if (modal) return Promise.resolve(modal);
    return waitForElement(
      '[role="dialog"], [data-qa-type*="modal"], [data-qa-type*="dialog"], .tui-dialog, [class*="Modal"]',
      timeoutMs
    );
  }

  function waitForElement(selector: string, timeoutMs: number): Promise<Element | null> {
    const el = document.querySelector(selector);
    if (el) return Promise.resolve(el);
    return new Promise((resolve) => {
      const observer = new MutationObserver(() => {
        const found = document.querySelector(selector);
        if (found) {
          observer.disconnect();
          clearTimeout(timer);
          resolve(found);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      const timer = setTimeout(() => {
        observer.disconnect();
        resolve(document.querySelector(selector));
      }, timeoutMs);
    });
  }

  function waitForElementRemoved(element: Element, timeoutMs: number): Promise<void> {
    if (!element.isConnected) return Promise.resolve();
    return new Promise((resolve) => {
      const observer = new MutationObserver(() => {
        if (!element.isConnected) {
          observer.disconnect();
          clearTimeout(timer);
          resolve();
        }
      });
      observer.observe(element.parentElement ?? document.body, { childList: true, subtree: true });
      const timer = setTimeout(() => {
        observer.disconnect();
        resolve();
      }, timeoutMs);
    });
  }

  function getDetailPopupElement(): Element | null {
    return (
      document.querySelector('[role="dialog"]') ??
      document.querySelector('[data-qa-type*="modal"]') ??
      document.querySelector('[data-qa-type*="dialog"]') ??
      document.querySelector('.tui-dialog, [class*="Modal"], [class*="modal"]')
    );
  }

  function closeDetailPopupIfOpen(): void {
    const modal = getDetailPopupElement();
    if (modal && modal.isConnected) {
      const closeBtn =
        modal.querySelector('[aria-label="Закрыть"]') ??
        modal.querySelector('[data-qa-type*="close"]') ??
        modal.querySelector('button[class*="close"]');
      if (closeBtn && typeof (closeBtn as HTMLElement).click === "function") {
        (closeBtn as HTMLElement).click();
        return;
      }
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    }
  }

  function scrollDetailPanelToEnd(detailRoot: Element | null): void {
    if (!detailRoot || !(detailRoot instanceof HTMLElement)) return;
    let el: HTMLElement | null = detailRoot;
    for (let i = 0; i < 8 && el; i++) {
      if (el.scrollHeight > el.clientHeight) {
        el.scrollTop = el.scrollHeight;
      }
      el = el.parentElement;
    }
  }

  function extractCardLast4FromDetail(detailRoot: Element): string | null {
    const accountSection = document.querySelector('[data-qa-type="desktop-pumba-account-operation"]');
    const text = accountSection ? clean(accountSection.textContent) : "";
    if (text) {
      const four = extractLast4(text);
      if (four) return four;
    }
    const fullText = clean(detailRoot.textContent) || "";
    const cardLike = fullText.match(/(?:карт[аыуе]?|card|••••)\s*[*•·\s]*(\d{4})\b/i) ||
      fullText.match(/\b(\d{4})\s*[₽р]|\b(\d{4})\s*$/m);
    if (cardLike) return cardLike[1] || cardLike[2] || null;
    return extractLast4(fullText);
  }

  function findTargetRowForDetail(rows: Record<string, unknown>[], detail: NonNullable<ReturnType<typeof readCurrentDetailSnapshot>>): Record<string, unknown> | undefined {
    const normalizedDetailTitle = normalizeKey(detail.title || "");
    const detailAmountValue = detail.amount;

    const candidates = rows.filter((row) => {
      if (!normalizedDetailTitle) return true;
      const rowTitle = normalizeKey(row.merchant_name || "");
      return rowTitle.includes(normalizedDetailTitle) || normalizedDetailTitle.includes(rowTitle);
    });

    for (const row of candidates) {
      if (detailAmountValue === null) return row;
      if (Math.abs(Number(row.amount || 0) - detailAmountValue) < 0.01) return row;
    }

    return rows.length > 0 ? rows[0] : undefined;
  }

  function detailMatchesRow(row: Record<string, unknown>, detail: NonNullable<ReturnType<typeof readCurrentDetailSnapshot>>): boolean {
    if (detail.amount !== null && Math.abs(Number(row.amount || 0) - detail.amount) >= 0.01) {
      return false;
    }
    const rowTitle = normalizeKey(row.merchant_name || "");
    const detailTitle = normalizeKey(detail.title || "");
    if (rowTitle && detailTitle) {
      return rowTitle.includes(detailTitle) || detailTitle.includes(rowTitle);
    }
    return true;
  }

  function applyDetailSnapshotToRow(row: Record<string, unknown>, detail: NonNullable<ReturnType<typeof readCurrentDetailSnapshot>>): void {
    if (detail.external_id) {
      row.external_id = detail.external_id;
    }
    if (detail.posted_at) {
      row.posted_at = detail.posted_at;
    }
    if (detail.mcc && !row.mcc) {
      row.mcc = detail.mcc;
    }
    if (detail.account_hint) {
      row.account_hint = row.account_hint || detail.account_hint;
      const rp = row.raw_payload as Record<string, unknown>;
      if (rp) rp.account_hint = row.account_hint;
    }
    if (Array.isArray(detail.line_items) && detail.line_items.length > 0) {
      row.line_items = detail.line_items;
    }
  }

  function parseShoppingListLineItems(): Record<string, unknown>[] {
    // Prefer the open "Список покупок" dialog: it contains all line items in the DOM (scroll content).
    // The detail panel only has a short preview (e.g. 4 items); the dialog has the full list.
    let section: Element | null = null;
    const dialog = getDetailPopupElement();
    if (dialog?.isConnected) {
      const titleEl = dialog.querySelector('[data-qa-type="tui/header.title"]');
      const title = clean(titleEl?.textContent);
      if (title && /список\s*покупок/i.test(title)) {
        section = dialog;
      }
    }
    if (!section) {
      section = document.querySelector('[data-qa-type="desktop-pumba-shoppings-operation"]');
    }
    if (!section) {
      section = findSectionByHeading(/список\s*покупок/i);
    }
    if (!section) return [];

    const cells = Array.from(section.querySelectorAll('[data-qa-type="tui/cell"]'));
    const fallbackCells = cells.length === 0 ? findListItemsWithAmounts(section) : [];
    const items = cells.length > 0 ? cells : fallbackCells;
    const result: Record<string, unknown>[] = [];

    for (const cell of items as Element[]) {
      const cellText = clean(cell.textContent);
      if (!cellText) continue;

      const amountMatch = cellText.match(/[+\-−]?\d[\d\s]*(?:[.,]\d+)?\s*[₽рР]/i);
      if (!amountMatch) continue;

      const amountInfo = parseAmount(amountMatch[0]);
      if (!amountInfo) continue;

      const title =
        clean(cell.querySelector('[data-qa-type="tui/multiline-text-fade"]')?.textContent) ||
        clean(cell.querySelector('[data-qa-type="tui/typography"]')?.textContent) ||
        clean(cellText.slice(0, amountMatch.index));
      if (!title || /список покупок|все\s*$|итого\s*$/i.test(title)) continue;

      const qtyMatch = cellText.match(
        /(\d+(?:[.,]\d+)?)\s*[xх×]\s*([+\-−]?\d[\d\s]*(?:[.,]\d+)?)\s*[₽р]/i
      );
      const quantity =
        qtyMatch && Number.isFinite(Number(qtyMatch[1].replace(",", ".")))
          ? Number(qtyMatch[1].replace(",", "."))
          : null;

      result.push({
        title,
        amount: amountInfo.value,
        quantity,
        unit: null,
        raw_payload: {
          source: "shopping_list",
          raw_text: cellText,
        },
      });
    }

    return result;
  }

  function findSectionByHeading(regex: RegExp): Element | null {
    const detailRoot = document.querySelector('[data-qa-type="desktop-pumba-detail-operation"]');
    if (!detailRoot) return null;
    const all = detailRoot.querySelectorAll('[data-qa-type="tui/typography"], h2, h3, [class*="heading"]');
    for (const el of Array.from(all)) {
      if (regex.test(clean(el.textContent) || "")) {
        let container = el.closest('[data-qa-type]') || el.parentElement;
        for (let i = 0; i < 3 && container; i++) {
          if (container.querySelectorAll('[data-qa-type="tui/cell"]').length > 0) return container;
          container = container.parentElement;
        }
        return el.parentElement;
      }
    }
    return null;
  }

  function findListItemsWithAmounts(container: Element | null): Element[] {
    if (!container) return [];
    const withAmount: Element[] = [];
    const walk = (node: Element) => {
      if (node.nodeType !== 1) return;
      const text = clean(node.textContent);
      const hasAmount = text && /[+\-−]?\d[\d\s]*(?:[.,]\d+)?\s*[₽р]/.test(text);
      if (hasAmount && text.length < 400) {
        const childrenWithAmount = Array.from(node.children).filter((c: Element) =>
          /[+\-−]?\d[\d\s]*(?:[.,]\d+)?\s*[₽р]/.test(clean(c.textContent) || "")
        );
        if (childrenWithAmount.length === 0) {
          withAmount.push(node);
          return;
        }
      }
      for (const ch of Array.from(node.children)) walk(ch as Element);
    };
    walk(container);
    return withAmount;
  }

  function parseCashbackLineItems(): Record<string, unknown>[] {
    let section = document.querySelector('[data-qa-type="desktop-pumba-cashbacks-operation"]');
    if (!section) {
      section = findSectionByHeading(/кэшбэк|cashback/i);
    }
    if (!section) return [];

    const cells = Array.from(section.querySelectorAll('[data-qa-type="tui/cell"]'));
    const result: Record<string, unknown>[] = [];

    for (const cell of cells) {
      const title = clean(cell.querySelector('[data-qa-type="cashback-title"]')?.textContent) ||
        clean(cell.querySelector('[data-qa-type="tui/typography"]')?.textContent);
      const sumEl = cell.querySelector('[data-qa-type="sum"]') || cell;
      const sumText = clean(sumEl.textContent) ?? "";
      const amountMatch = sumText.match(/[+\-−]?\d[\d\s]*(?:[.,]\d+)?\s*[₽р]/i);
      const amountInfo = amountMatch ? parseAmount(amountMatch[0]) : null;
      if (!amountInfo) continue;
      const label = title || "Кэшбэк";

      result.push({
        title: label.startsWith("Кэшбэк") ? label : `Кэшбэк: ${label}`,
        amount: amountInfo.value,
        quantity: null,
        unit: null,
        raw_payload: {
          source: "cashback",
          raw_text: clean(cell.textContent) || null,
        },
      });
    }

    return result;
  }

  function buildFeedRowKey(parts: Record<string, unknown>): string {
    return hashString(
      [
        parts.title || "",
        String(parts.amount ?? ""),
        parts.postedAt || "",
        parts.subtitle || "",
        parts.description || "",
        parts.message || "",
        parts.headerLabel || "",
      ].join("|")
    );
  }

  function buildDedupeHash(row: Record<string, unknown>): string {
    return `tbw_${hashString(
      [
        row.external_id || "",
        row.merchant_name || "",
        String(row.amount ?? ""),
        row.posted_at || "",
        (row.raw_payload as Record<string, unknown> | undefined || {}).feed_subtitle || "",
        (row.raw_payload as Record<string, unknown> | undefined || {}).feed_description || "",
        (row.raw_payload as Record<string, unknown> | undefined || {}).feed_message || "",
        row.account_hint || "",
      ].join("|")
    )}`;
  }

  function dedupeRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
    const map = new Map<string, Record<string, unknown>>();
    for (const row of rows) {
      const key = row.external_id ? `ext:${row.external_id}` : `dedupe:${row.dedupe_hash}`;
      if (!map.has(key)) {
        map.set(key, row);
      }
    }
    return Array.from(map.values());
  }

  function normalizeKey(value: unknown): string {
    return clean(value)?.toLowerCase() || "";
  }

  function clean(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const normalized = value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
    return normalized || null;
  }

  function hashString(input: string): string {
    let hash = 2166136261;
    for (let i = 0; i < input.length; i++) {
      hash ^= input.charCodeAt(i);
      hash +=
        (hash << 1) +
        (hash << 4) +
        (hash << 7) +
        (hash << 8) +
        (hash << 24);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  function toMs(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) return numeric;
      const date = new Date(value);
      if (Number.isFinite(date.getTime())) return date.getTime();
    }
    return null;
  }

  function scrollForMore() {
    const feedRoot = document.querySelector('[data-qa-type="atom-operations-feed-root"]');
    const scrollable = findScrollableAncestor(feedRoot);
    if (scrollable) {
      scrollable.scrollTop = scrollable.scrollHeight - scrollable.clientHeight;
    }
    if (feedRoot) {
      feedRoot.scrollIntoView({ block: "end", behavior: "auto" });
    }
    window.scrollTo(0, document.body.scrollHeight);
  }

  function findScrollableAncestor(el: Element | null): Element | null {
    let p = el && el.parentElement;
    while (p) {
      const style = window.getComputedStyle(p);
      const overflowY = style.overflowY || style.overflow;
      if ((overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") && p.scrollHeight > p.clientHeight) {
        return p;
      }
      p = p.parentElement;
    }
    return null;
  }

  function wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
