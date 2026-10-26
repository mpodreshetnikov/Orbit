import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { router } from "expo-router";
import { Alert } from "react-native";
import { fetchImportBatch, REPORT_PAGE } from "@/features/money/import";
import ImportBatchScreen from "@/screens/import-batch-screen";
import ImportHistoryScreen from "@/screens/import-history-screen";
import MoneyImportScreen from "@/screens/money-import-screen";
import MoneyScreen from "@/screens/money-screen";
import {
  calls,
  db,
  fail,
  fakeSession,
  rpcHandlers,
  seed,
  setSession,
  supabase,
} from "../../test/fake-supabase";
import { household, NOW, PERSON, USER_ID } from "../../test/fixtures";
import { renderScreens } from "../../test/render";

jest.mock("@/lib/supabase", () => jest.requireActual("../../test/fake-supabase"));

const mockFiles: Record<string, string> = {};
const mockPicked: { current: { name: string; uri: string } | null } = { current: null };

jest.mock("expo-document-picker", () => ({
  getDocumentAsync: async () =>
    mockPicked.current
      ? { canceled: false, assets: [mockPicked.current] }
      : { canceled: true, assets: null },
}));
jest.mock("expo-file-system", () => ({
  File: class {
    uri: string;
    constructor(uri: string) {
      this.uri = uri;
    }
    async text() {
      const text = mockFiles[this.uri];
      if (text === undefined) throw new Error("no such file");
      return text;
    }
  },
}));
jest.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "SHA-256" },
  digestStringAsync: async (_algorithm: string, payload: string) => `sha:${payload.length}`,
}));

const HEADER =
  "Дата операции;Дата платежа;Номер карты;Статус;Сумма операции;Валюта операции;Категория;MCC;Описание";
const STATEMENT = [
  HEADER,
  "01.10.2026 12:30:00;;*1234;OK;-120,50;RUB;Кафе;5812;Кофейня",
  "02.10.2026 09:00:00;;*5678;OK;-990,00;RUB;Супермаркеты;5411;Пятёрочка",
].join("\n");

const routes = {
  "money/index": MoneyScreen,
  "money/import/index": MoneyImportScreen,
  "money/import/history": ImportHistoryScreen,
  "money/import/[batch]": ImportBatchScreen,
};

const batch = (id: string, status: string, created_at: string) => ({
  id,
  payer_person_id: PERSON.id,
  source: "tbank",
  import_type: "file",
  status,
  parsed_transactions_count: 2,
  inserted_count: status === "completed" ? 2 : 0,
  skipped_count: 0,
  created_at,
  completed_at: status === "completed" ? created_at : null,
  meta: null,
});

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, advanceTimers: true });
  mockFiles["file:///ops.csv"] = STATEMENT;
  mockPicked.current = { name: "ops.csv", uri: "file:///ops.csv" };
  seed({
    ...household(),
    money_accounts: [],
    money_cards: [],
    money_import_batches: [
      batch("b-old", "completed", "2026-10-01T10:00:00Z"),
      batch("b-new", "pending", "2026-10-20T10:00:00Z"),
    ],
    money_import_batch_rows: [
      {
        id: "r1",
        batch_id: "b-new",
        row_kind: "transaction",
        source_row_index: 0,
        status: "inserted",
        message: null,
        p_merchant_name: "Кофейня",
        p_amount: -120.5,
        p_currency: "RUB",
        p_posted_at: "2026-10-01T12:30:00.000Z",
      },
      {
        id: "r2",
        batch_id: "b-new",
        row_kind: "transaction",
        source_row_index: 1,
        status: "error",
        message: "Нет счёта",
        p_title: "Пятёрочка",
      },
    ],
  });
  rpcHandlers["money-import"] = (body: Record<string, unknown>) =>
    body.action === "preview_rows" ? { batch_id: "b-new" } : { ok: true };
  setSession(fakeSession(USER_ID));
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

const imports = () => calls.rpc.filter((call) => call.name === "money-import");

describe("a statement import", () => {
  it("starts as soon as the file is read, naming no account, and opens the import", async () => {
    await renderScreens(routes, "/money");
    await fireEvent.press(await screen.findByText("Импорт"));
    expect(await screen.findByText("1. БАНК")).toBeOnTheScreen();
    await fireEvent.press(screen.getByText("Загрузить файл"));

    expect(await screen.findByText("Импорт ждёт применения")).toBeOnTheScreen();
    const [preview] = imports();
    expect(preview!.args).toEqual(
      expect.objectContaining({
        action: "preview_rows",
        source: "tbank",
        payer_person_id: PERSON.id,
        import_type: "file",
        file_path: "ops.csv",
      }),
    );
    const rows = (preview!.args as { rows: Record<string, unknown>[] }).rows;
    expect(rows).toEqual([
      expect.objectContaining({ account_hint: "1234", amount: -120.5 }),
      expect.objectContaining({ account_hint: "5678", amount: -990 }),
    ]);
    expect(rows[0]).not.toHaveProperty("account_id");
    // The server opens the bank's account when there is none; the phone makes none itself.
    expect(db.tables.money_accounts).toEqual([]);
  });

  it("greys out what needs a computer, and the file is the way in", async () => {
    await renderScreens(routes, "/money/import");

    expect(await screen.findByTestId("import-bank-tbank")).toHaveProp("accessibilityState", {
      selected: true,
      disabled: false,
    });
    expect(screen.getByTestId("import-bank-alfa")).toBeDisabled();
    expect(screen.getByText("Только из личного кабинета, на компьютере")).toBeOnTheScreen();
    expect(screen.getByTestId("import-bank-other")).toBeDisabled();
    expect(screen.getByTestId("import-method-extension")).toBeDisabled();
    expect(screen.getByText("Нужен браузер на компьютере с расширением Orbit")).toBeOnTheScreen();
    expect(screen.getByText("рекомендуем")).toBeOnTheScreen();
    expect(
      screen.getByText("Настраивается в браузере на компьютере, где стоит расширение Orbit."),
    ).toBeOnTheScreen();
  });

  it("imports a file handed over by another app", async () => {
    await renderScreens(routes, "/money/import?file=file%3A%2F%2F%2Fops.csv&name=ops.csv");

    expect(await screen.findByText("Импорт ждёт применения")).toBeOnTheScreen();
    expect(imports()).toHaveLength(1);
  });

  it("says when the file cannot be read, has nothing in it, or the upload fails", async () => {
    mockPicked.current = { name: "gone.csv", uri: "file:///gone.csv" };
    await renderScreens(routes, "/money/import");
    await fireEvent.press(await screen.findByText("Загрузить файл"));
    expect(await screen.findByText("Не удалось прочитать файл.")).toBeOnTheScreen();

    mockFiles["file:///empty.csv"] = HEADER;
    mockPicked.current = { name: "empty.csv", uri: "file:///empty.csv" };
    await fireEvent.press(screen.getByText("Загрузить файл"));
    expect(await screen.findByText("В файле нет операций.")).toBeOnTheScreen();

    mockPicked.current = { name: "ops.csv", uri: "file:///ops.csv" };
    jest.spyOn(supabase.functions, "invoke").mockResolvedValueOnce({
      data: null,
      error: {
        message: "Edge Function returned a non-2xx status code",
        context: { json: async () => ({ error: "Пакет уже загружен" }) },
      },
    } as never);
    await fireEvent.press(screen.getByText("Загрузить файл"));
    expect(await screen.findByText("Пакет уже загружен")).toBeOnTheScreen();
  });
});

describe("the import history", () => {
  it("lists a new preview at once, before it is applied", async () => {
    seed({
      ...db.tables,
      money_import_batches: [batch("b-old", "completed", "2026-10-01T10:00:00Z")],
    });
    rpcHandlers["money-import"] = () => {
      db.tables.money_import_batches!.push(batch("b-new", "pending", "2026-10-20T10:00:00Z"));
      return { batch_id: "b-new" };
    };
    const { client } = await renderScreens(routes, "/money/import");
    // The app keeps a read fresh for 30 seconds; the history must not wait that out.
    client.setDefaultOptions({ queries: { retry: false, gcTime: Infinity, staleTime: 30_000 } });
    await fireEvent.press(await screen.findByText("История импортов"));
    expect(await screen.findAllByText(/^\d{2}\.10\.2026/)).toHaveLength(1);
    await act(() => router.push("/money/import"));
    await fireEvent.press(await screen.findByText("Загрузить файл"));
    await screen.findByText("Применить пакет");
    await act(() => router.push("/money/import/history"));
    await waitFor(() => expect(screen.getAllByText(/^\d{2}\.10\.2026/)).toHaveLength(2));
  });

  it("reads every page of a large report, in order", async () => {
    db.tables.money_import_batch_rows = Array.from({ length: REPORT_PAGE + 2 }, (_, index) => ({
      id: `r-${String(index).padStart(4, "0")}`,
      batch_id: "b-new",
      row_kind: "transaction",
      source_row_index: REPORT_PAGE + 1 - index,
      status: "inserted",
      message: null,
    }));
    const report = await fetchImportBatch("b-new");
    expect(report!.rows).toHaveLength(REPORT_PAGE + 2);
    expect(report!.rows.map((row) => row.source_row_index).slice(0, 3)).toEqual([0, 1, 2]);
  });

  it("lists the imports newest first, and a pending one is applied from its report", async () => {
    await renderScreens(routes, "/money/import");
    await fireEvent.press(await screen.findByText("История импортов"));
    const [first, second] = await screen.findAllByText(/^\d{2}\.10\.2026/);
    expect(first).toHaveTextContent(/^20\.10\.2026/);
    expect(second).toHaveTextContent(/^01\.10\.2026/);
    expect(screen.getByText("Ожидает")).toBeOnTheScreen();
    expect(screen.getByText("Завершён")).toBeOnTheScreen();

    await fireEvent.press(first!);
    expect(await screen.findByText("Кофейня")).toBeOnTheScreen();
    expect(screen.getByText("Пятёрочка")).toBeOnTheScreen();
    expect(screen.getByText("Нет счёта")).toBeOnTheScreen();
    expect(screen.getByText("Импортировано")).toBeOnTheScreen();

    await fireEvent.press(screen.getByText("Применить пакет"));
    await waitFor(() =>
      expect(imports().map((call) => call.args)).toEqual([
        { action: "apply_batch", batch_id: "b-new" },
      ]),
    );
  });

  it("discards a pending import, and says when the action fails", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    await renderScreens(routes, "/money/import/b-new");
    await fireEvent.press(await screen.findByText("Не применять"));
    await waitFor(() =>
      expect(imports().map((call) => call.args)).toEqual([
        { action: "discard_batch", batch_id: "b-new" },
      ]),
    );
    fail("money-import");
    await fireEvent.press(screen.getByText("Не применять"));
    await waitFor(() =>
      expect(alert).toHaveBeenCalledWith("Что-то пошло не так", "money-import failed"),
    );
  });

  it("shows a completed import without the review, and an empty history its hint", async () => {
    await renderScreens(routes, "/money/import/b-old");
    expect(await screen.findByText("Готово. Добавлено операций: 2, уже были: 0")).toBeOnTheScreen();
    expect(screen.getByText(/Вкладку банка можно закрыть/)).toBeOnTheScreen();
    expect(screen.getByText("В этой партии нет импортированных строк.")).toBeOnTheScreen();
    expect(screen.queryByText("Применить пакет")).toBeNull();

    seed({ ...db.tables, money_import_batches: [] });
    await renderScreens(routes, "/money/import/history");
    expect(
      await screen.findByText("Здесь появятся партии импорта для выбранного человека."),
    ).toBeOnTheScreen();
  });

  it("rolls an applied import back after a confirmation, and says when it cannot", async () => {
    const alert = jest.spyOn(Alert, "alert");
    rpcHandlers.money_rollback_import_batch = () => {
      const target = db.tables.money_import_batches!.find((row) => row.id === "b-old")!;
      target.status = "rolled_back";
      target.meta = { rolled_back_transactions: 2 };
      return { status: "rolled_back" };
    };
    await renderScreens(routes, "/money/import/b-old");
    alert.mockImplementationOnce((_title, _message, buttons) => {
      expect(_message).toBe(
        "Удалим операции, которые добавил этот импорт (2), и позиции чеков, которые он дописал к уже существовавшим операциям. Остальное не тронем. Импорт потом можно запустить заново.",
      );
      buttons?.find((button) => button.style === "destructive")?.onPress?.();
    });
    await fireEvent.press(await screen.findByText("Откатить импорт"));
    await waitFor(() =>
      expect(calls.rpc).toContainEqual({
        name: "money_rollback_import_batch",
        args: { p_batch_id: "b-old" },
      }),
    );
    expect(await screen.findByText("Импорт откачен")).toBeOnTheScreen();
    expect(screen.getByText(/Удалено операций: 2/)).toBeOnTheScreen();
    expect(screen.getByText("Откачен")).toBeOnTheScreen();
    expect(screen.queryByText("Откатить импорт")).toBeNull();

    seed({
      ...db.tables,
      money_import_batches: [batch("b-old", "completed", "2026-10-01T10:00:00Z")],
    });
    fail("money_rollback_import_batch");
    await renderScreens(routes, "/money/import/b-old");
    alert.mockImplementationOnce((_title, _message, buttons) =>
      buttons?.find((button) => button.style === "destructive")?.onPress?.(),
    );
    alert.mockImplementationOnce(() => {});
    await fireEvent.press(await screen.findByText("Откатить импорт"));
    await waitFor(() =>
      expect(alert).toHaveBeenLastCalledWith(
        "Не удалось откатить импорт",
        "money_rollback_import_batch failed",
      ),
    );
  });

  it("follows a running import until it lands", async () => {
    seed({
      ...db.tables,
      money_import_batches: [
        { ...batch("b-run", "running", "2026-10-20T10:00:00Z"), parsed_transactions_count: 7 },
      ],
    });
    await renderScreens(routes, "/money/import/b-run");
    expect(await screen.findByText("Импорт идёт")).toBeOnTheScreen();
    expect(screen.getByText(/Прочитано операций: 7/)).toBeOnTheScreen();
    expect(screen.queryByText("Откатить импорт")).toBeNull();

    db.tables.money_import_batches![0] = batch("b-run", "completed", "2026-10-20T10:00:00Z");
    await act(() => jest.advanceTimersByTimeAsync(3100));
    expect(await screen.findByText("Готово. Добавлено операций: 2, уже были: 0")).toBeOnTheScreen();
  });

  it("reviews the imports of a week, a month, chosen days, or all time", async () => {
    const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();
    seed({
      ...db.tables,
      money_import_batches: [
        { ...batch("b-1", "completed", daysAgo(2)), inserted_count: 5 },
        batch("b-2", "rolled_back", daysAgo(3)),
        { ...batch("b-3", "completed", daysAgo(20)), inserted_count: 40, error_count: 1 },
      ],
    });
    await renderScreens(routes, "/money/import/history");
    expect(
      await screen.findByText("Импортов: 3 · добавлено операций: 45 · уже были: 0 · ошибок: 1"),
    ).toBeOnTheScreen();
    expect(screen.getByText("Откачено импортов: 1")).toBeOnTheScreen();

    await fireEvent.press(screen.getByText("Неделя"));
    expect(
      await screen.findByText("Импортов: 2 · добавлено операций: 5 · уже были: 0 · ошибок: 0"),
    ).toBeOnTheScreen();
    expect(screen.getAllByText(/^\d{2}\.10\.2026/)).toHaveLength(2);

    await fireEvent.press(screen.getByText("Месяц"));
    expect(
      await screen.findByText("Импортов: 3 · добавлено операций: 45 · уже были: 0 · ошибок: 1"),
    ).toBeOnTheScreen();

    await fireEvent.press(screen.getByText("Свой период"));
    await fireEvent(screen.getByTestId("import-review-from"), "change", {
      nativeEvent: { timestamp: NOW.getTime() - 25 * 86_400_000 },
    });
    await fireEvent(screen.getByTestId("import-review-to"), "change", {
      nativeEvent: { timestamp: NOW.getTime() - 15 * 86_400_000 },
    });
    expect(
      await screen.findByText("Импортов: 1 · добавлено операций: 40 · уже были: 0 · ошибок: 1"),
    ).toBeOnTheScreen();

    await fireEvent(screen.getByTestId("import-review-to"), "change", {
      nativeEvent: { timestamp: NOW.getTime() - 24 * 86_400_000 },
    });
    expect(await screen.findByText("За этот период импортов не было.")).toBeOnTheScreen();
  });

  it("says when a report is not there", async () => {
    await renderScreens(routes, "/money/import/missing");
    expect(await screen.findByText("Ничего не найдено")).toBeOnTheScreen();
  });
});
