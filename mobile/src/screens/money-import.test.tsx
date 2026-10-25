import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { router } from "expo-router";
import { ActionSheetIOS, Alert } from "react-native";
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

const tbank = (id: string, label: string) => ({
  id,
  owner_person_id: PERSON.id,
  account_label: label,
  account_kind: "debit",
  currency: "RUB",
  source: "tbank",
  is_active: true,
});

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

function pickOption(label: string) {
  jest
    .spyOn(ActionSheetIOS, "showActionSheetWithOptions")
    .mockImplementationOnce((options, callback) => callback(options.options.indexOf(label)));
}

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
  it("reads the file, makes the T-Bank account it needs, and sends the rows for a preview", async () => {
    await renderScreens(routes, "/money");
    await fireEvent.press(await screen.findByText("Импорт"));
    await fireEvent.press(await screen.findByText("Загрузить файл"));

    expect(await screen.findByText("ops.csv · 2")).toBeOnTheScreen();
    expect(screen.getByText("Кофейня")).toBeOnTheScreen();
    expect(screen.getByText("Нет счетов T-Bank. Сначала добавьте счёт.")).toBeOnTheScreen();
    expect(screen.getByText("Не для всех карт выбран счёт")).toBeOnTheScreen();

    await fireEvent.press(screen.getByText("Создать счёт T-Bank"));
    await waitFor(() =>
      expect(db.tables.money_accounts).toEqual([
        expect.objectContaining({ owner_person_id: PERSON.id, source: "tbank" }),
      ]),
    );
    expect(
      await screen.findByLabelText("Счёт по умолчанию для неизвестных карт: T-Bank"),
    ).toBeOnTheScreen();
    expect(screen.queryByText("Не для всех карт выбран счёт")).toBeNull();

    await fireEvent.press(screen.getByText("Подтвердить импорт"));
    expect(await screen.findByText("Импортировано 0, пропущено дубликатов: 0.")).toBeOnTheScreen();
    const [preview] = imports();
    const account = (db.tables.money_accounts[0] as { id: string }).id;
    expect(preview!.args).toEqual(
      expect.objectContaining({
        action: "preview_rows",
        source: "tbank",
        payer_person_id: PERSON.id,
        import_type: "file",
        file_path: "ops.csv",
      }),
    );
    expect((preview!.args as { rows: { account_id: string }[] }).rows).toEqual([
      expect.objectContaining({ account_id: account, amount: -120.5 }),
      expect.objectContaining({ account_id: account, amount: -990 }),
    ]);
  });

  it("maps each card to its account, by the cards known and by hand", async () => {
    seed({
      ...db.tables,
      money_accounts: [tbank("acc-a", "Тинькофф Black"), tbank("acc-b", "Тинькофф Platinum")],
      money_cards: [{ id: "c1", account_id: "acc-a", last4: "1234", card_label: null }],
    });
    await renderScreens(routes, "/money/import?file=file%3A%2F%2F%2Fops.csv&name=ops.csv");

    expect(await screen.findByLabelText("Счёт для карты *1234: Тинькофф Black")).toBeOnTheScreen();
    expect(screen.getByText("Не для всех карт выбран счёт")).toBeOnTheScreen();

    pickOption("Тинькофф Platinum");
    await fireEvent.press(screen.getByLabelText("Счёт для карты *5678: Выберите счет..."));
    expect(
      await screen.findByLabelText("Счёт для карты *5678: Тинькофф Platinum"),
    ).toBeOnTheScreen();

    await fireEvent.press(screen.getByText("Подтвердить импорт"));
    await waitFor(() => expect(imports()).toHaveLength(1));
    expect((imports()[0]!.args as { rows: { account_id: string }[] }).rows).toEqual([
      expect.objectContaining({ account_id: "acc-a" }),
      expect.objectContaining({ account_id: "acc-b" }),
    ]);
  });

  it("says when the file cannot be read, and when the preview fails", async () => {
    seed({ ...db.tables, money_accounts: [tbank("acc-a", "Тинькофф Black")] });
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    mockPicked.current = { name: "gone.csv", uri: "file:///gone.csv" };
    await renderScreens(routes, "/money/import");
    await fireEvent.press(await screen.findByText("Загрузить файл"));
    expect(await screen.findByText("Не удалось прочитать файл.")).toBeOnTheScreen();

    mockPicked.current = null;
    await fireEvent.press(screen.getByText("Загрузить файл"));
    expect(screen.getByText("gone.csv · 0")).toBeOnTheScreen();

    mockPicked.current = { name: "ops.csv", uri: "file:///ops.csv" };
    await fireEvent.press(screen.getByText("Загрузить файл"));
    jest.spyOn(supabase.functions, "invoke").mockResolvedValueOnce({
      data: null,
      error: {
        message: "Edge Function returned a non-2xx status code",
        context: { json: async () => ({ error: "Пакет уже загружен" }) },
      },
    } as never);
    await fireEvent.press(await screen.findByText("Подтвердить импорт"));
    await waitFor(() =>
      expect(alert).toHaveBeenCalledWith("Что-то пошло не так", "Пакет уже загружен"),
    );
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
    await fireEvent.press(await screen.findByText("Создать счёт T-Bank"));
    await screen.findByLabelText("Счёт по умолчанию для неизвестных карт: T-Bank");
    await fireEvent.press(screen.getByText("Подтвердить импорт"));
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
    expect(await screen.findByText("Импортировано 2, пропущено дубликатов: 0.")).toBeOnTheScreen();
    expect(screen.getByText("В этой партии нет импортированных строк.")).toBeOnTheScreen();
    expect(screen.queryByText("Применить пакет")).toBeNull();

    seed({ ...db.tables, money_import_batches: [] });
    await renderScreens(routes, "/money/import/history");
    expect(
      await screen.findByText("Здесь появятся партии импорта для выбранного человека."),
    ).toBeOnTheScreen();
  });

  it("says when a report is not there", async () => {
    await renderScreens(routes, "/money/import/missing");
    expect(await screen.findByText("Ничего не найдено")).toBeOnTheScreen();
  });
});
