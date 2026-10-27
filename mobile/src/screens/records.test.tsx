import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { ActionSheetIOS, Alert, Text } from "react-native";
import * as WebBrowser from "expo-web-browser";
import HealthScreen from "@/screens/health-screen";
import RecordFormScreen from "@/screens/record-form-screen";
import RecordScreen from "@/screens/record-screen";
import RecordsScreen from "@/screens/records-screen";
import {
  db,
  fail,
  failOnce,
  fakeSession,
  rpcHandlers,
  seed,
  setSession,
} from "../../test/fake-supabase";
import { NOW, PERSON, USER_ID } from "../../test/fixtures";
import { renderScreens } from "../../test/render";

jest.mock("@/lib/supabase", () => jest.requireActual("../../test/fake-supabase"));
jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn(async () => ({})) }));

const routes = {
  "health/index": HealthScreen,
  "health/records/index": RecordsScreen,
  "health/records/[id]": RecordScreen,
  "health/records/edit": RecordFormScreen,
};

function record(id: string, title: string, extra = {}) {
  return {
    id,
    person_id: PERSON.id,
    created_by_user_id: USER_ID,
    record_type: "lab",
    record_date: "2026-10-01",
    title,
    notes: null,
    status: "active",
    removed_at: null,
    created_at: "2026-10-01T10:00:00Z",
    updated_at: "2026-10-01T10:00:00Z",
    ocr_text: null,
    ocr_error: null,
    structure_error: null,
    llm_summary: null,
    llm_keywords: null,
    llm_suggested_checkup_completions: null,
    ...extra,
  };
}

const BLOOD = record("r-blood", "Общий анализ крови", {
  record_date: "2026-10-15",
  notes: "Натощак",
  llm_summary: "Гемоглобин в норме",
  llm_keywords: ["кровь", "гемоглобин"],
});
const VISIT = record("r-visit", "Приём терапевта", {
  record_type: "visit",
  record_date: "2026-09-02",
});
const MRI = record("r-mri", "МРТ колена", { record_type: "imaging", record_date: "2026-08-20" });
const UNDATED = record("r-old", "Старая выписка", { record_type: "other", record_date: null });
const DRAFT = record("r-draft", "Черновик", { status: "pending_review" });

const PAGE = {
  id: "a-1",
  record_id: "r-blood",
  storage_path: "person-1/r-blood/page-1.jpg",
  mime_type: "image/jpeg",
  original_filename: "page-1.jpg",
  file_size: 1000,
  sort_order: 0,
  created_at: "2026-10-15T10:00:00Z",
};

function seedRecords() {
  seed({
    persons: [PERSON],
    medical_records: [VISIT, BLOOD, MRI, UNDATED, DRAFT],
    record_attachments: [PAGE],
  });
  rpcHandlers.get_record_observations = () => [
    {
      id: "o-1",
      obs_code: "hgb",
      obs_name: "Hemoglobin",
      catalog_name_ru: "Гемоглобин",
      value_numeric: 142,
      value_text: null,
      unit: "г/л",
      ref_range_low: 130,
      ref_range_high: 160,
      ref_range_text: null,
      status: "normal",
    },
    {
      id: "o-2",
      obs_code: null,
      obs_name: "Цвет",
      catalog_name_ru: null,
      value_numeric: null,
      value_text: "жёлтый",
      unit: null,
      ref_range_low: null,
      ref_range_high: null,
      ref_range_text: null,
      status: null,
    },
  ];
  rpcHandlers.get_record_findings = () => [
    {
      id: "f-1",
      catalog_finding_name_ru: "Киста",
      finding_type_text: "cyst",
      catalog_site_name_ru: "Печень",
      body_site_text: null,
      size_mm: 4,
      description: "простая",
    },
  ];
}

/** Answer the next action sheet with the option labelled `label`. */
function chooseInSheet(label: string) {
  jest
    .spyOn(ActionSheetIOS, "showActionSheetWithOptions")
    .mockImplementationOnce((options, callback) => callback(options.options.indexOf(label)));
}

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, advanceTimers: true });
  seedRecords();
  setSession(fakeSession(USER_ID));
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe("Health tab documents", () => {
  it("shows the error and retries", async () => {
    fail("medical_records");
    await renderScreens(routes, "/health");
    expect(await screen.findByText("medical_records is unavailable")).toBeOnTheScreen();
    seedRecords();
    await fireEvent.press(screen.getByText("Повторить"));
    expect(await screen.findByText("Общий анализ крови")).toBeOnTheScreen();
  });

  it("shows the three latest approved documents, newest first", async () => {
    await renderScreens(routes, "/health");
    expect(await screen.findByText("Общий анализ крови")).toBeOnTheScreen();
    expect(screen.getByText("Приём терапевта")).toBeOnTheScreen();
    expect(screen.getByText("МРТ колена")).toBeOnTheScreen();
    expect(screen.queryByText("Старая выписка")).toBeNull();
    expect(screen.queryByText("Черновик")).toBeNull();
  });

  it("says there are none yet", async () => {
    seed({ persons: [PERSON], medical_records: [] });
    await renderScreens(routes, "/health");
    expect(await screen.findByText(/Документов пока нет/)).toBeOnTheScreen();
  });

  it("opens all documents, searches them and narrows by type", async () => {
    await renderScreens(routes, "/health");
    await fireEvent.press(await screen.findByText("Все документы"));
    expect(await screen.findByText("Старая выписка")).toBeOnTheScreen();
    expect(screen.getByText(/Без даты/)).toBeOnTheScreen();
    expect(screen.queryByText("Черновик")).toBeNull();

    await fireEvent.press(screen.getByText("Приём врача"));
    expect(await screen.findByText("Приём терапевта")).toBeOnTheScreen();
    expect(screen.queryByText("МРТ колена")).toBeNull();
    await fireEvent.press(screen.getByText("Все типы"));
    expect(await screen.findByText("МРТ колена")).toBeOnTheScreen();
  });

  it("says when the list is empty and when nothing matches", async () => {
    seed({ persons: [PERSON], medical_records: [MRI] });
    await renderScreens(routes, "/health/records");
    expect(await screen.findByText("МРТ колена")).toBeOnTheScreen();
    await fireEvent.press(screen.getByText("Анализы"));
    expect(await screen.findByText("Ничего не найдено")).toBeOnTheScreen();
  });

  it("names the list's error and retries it", async () => {
    failOnce("medical_records");
    await renderScreens(routes, "/health/records");
    expect(await screen.findByText("medical_records is unavailable")).toBeOnTheScreen();
    await fireEvent.press(screen.getByText("Повторить"));
    expect(await screen.findByText("МРТ колена")).toBeOnTheScreen();
  });
});

describe("A document", () => {
  it("shows its type, date, notes, summary, keywords, results and findings", async () => {
    await renderScreens(routes, "/health/records/r-blood");
    expect(await screen.findByText("Натощак")).toBeOnTheScreen();
    expect(screen.getByText("Гемоглобин в норме")).toBeOnTheScreen();
    expect(screen.getByText("гемоглобин")).toBeOnTheScreen();
    expect(await screen.findByText("142 г/л")).toBeOnTheScreen();
    expect(screen.getByText("жёлтый")).toBeOnTheScreen();
    expect(await screen.findByText("Киста")).toBeOnTheScreen();
    expect(screen.getByText(/Печень · 4/)).toBeOnTheScreen();
    expect(await screen.findByText("page-1.jpg")).toBeOnTheScreen();
  });

  it("opens a page through a signed link", async () => {
    await renderScreens(routes, "/health/records/r-blood");
    await fireEvent.press(await screen.findByText("page-1.jpg"));
    await waitFor(() =>
      expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith(
        "https://files.test/medical-attachments/person-1/r-blood/page-1.jpg",
      ),
    );
  });

  it("names a link it could not make", async () => {
    fail("storage");
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    await renderScreens(routes, "/health/records/r-blood");
    await fireEvent.press(await screen.findByText("page-1.jpg"));
    await waitFor(() =>
      expect(alert).toHaveBeenCalledWith("Что-то пошло не так", "storage is unavailable"),
    );
  });

  it("says it has no pages or notes", async () => {
    await renderScreens(routes, "/health/records/r-mri");
    expect(await screen.findByText("Заметки не добавлены")).toBeOnTheScreen();
    expect(await screen.findByText("Нет вложений")).toBeOnTheScreen();
  });

  it("shows a part's error and retries it", async () => {
    failOnce("record_attachments");
    await renderScreens(routes, "/health/records/r-blood");
    expect(await screen.findByText("record_attachments is unavailable")).toBeOnTheScreen();
    await fireEvent.press(screen.getByText("Повторить"));
    expect(await screen.findByText("page-1.jpg")).toBeOnTheScreen();
  });

  it("names a missing document and retries a failed one", async () => {
    failOnce("medical_records");
    await renderScreens(routes, "/health/records/r-blood");
    expect(await screen.findByText("medical_records is unavailable")).toBeOnTheScreen();
    await fireEvent.press(screen.getByText("Повторить"));
    expect(await screen.findByText("Натощак")).toBeOnTheScreen();
  });

  it("goes from a result to its history", async () => {
    await renderScreens(
      { ...routes, "health/observations/[code]": () => <Text>history</Text> },
      "/health/records/r-blood",
    );
    await fireEvent.press(await screen.findByText("Гемоглобин"));
    expect(await screen.findByText("history")).toBeOnTheScreen();
  });

  it("edits its details", async () => {
    await renderScreens(routes, "/health/records/r-blood");
    await fireEvent.press(await screen.findByText("Редактировать"));
    await fireEvent.changeText(await screen.findByTestId("record-title"), "  ОАК  ");
    chooseInSheet("Приём врача");
    await fireEvent.press(screen.getByLabelText("Тип записи: Анализы"));
    await fireEvent(screen.getByTestId("record-date"), "change", {
      nativeEvent: { timestamp: new Date(2026, 9, 16, 12).getTime() },
    });
    await fireEvent.changeText(screen.getByTestId("record-notes"), "  ");
    await fireEvent.press(screen.getByText("Сохранить"));
    await waitFor(() =>
      expect(db.tables.medical_records?.find((row) => row.id === "r-blood")).toMatchObject({
        title: "ОАК",
        record_type: "visit",
        record_date: "2026-10-16",
        notes: null,
      }),
    );
    expect(await screen.findByText(/Приём врача · 16/)).toBeOnTheScreen();
  });

  it("clears and sets a date, and needs a title", async () => {
    await renderScreens(routes, "/health/records/edit?id=r-blood");
    await fireEvent.press(await screen.findByText("Очистить"));
    expect(screen.getByText("Без даты")).toBeOnTheScreen();
    await fireEvent.press(screen.getByText("Добавить"));
    expect(screen.getByTestId("record-date")).toBeOnTheScreen();
    await fireEvent.press(screen.getByText("Очистить"));
    await fireEvent.changeText(screen.getByTestId("record-title"), "");
    expect(screen.getByText("Обязательное поле")).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByTestId("record-title"), "ОАК");
    await fireEvent.press(screen.getByText("Сохранить"));
    await waitFor(() =>
      expect(db.tables.medical_records?.find((row) => row.id === "r-blood")).toMatchObject({
        record_date: null,
      }),
    );
  });

  it("names a refused save", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    await renderScreens(routes, "/health/records/edit?id=r-blood");
    await screen.findByTestId("record-title");
    fail("medical_records");
    await fireEvent.press(screen.getByText("Сохранить"));
    await waitFor(() =>
      expect(alert).toHaveBeenCalledWith("Что-то пошло не так", "medical_records is unavailable"),
    );
  });

  it("shows the edit form's error and retries", async () => {
    failOnce("medical_records");
    await renderScreens(routes, "/health/records/edit?id=r-blood");
    expect(await screen.findByText("medical_records is unavailable")).toBeOnTheScreen();
    await fireEvent.press(screen.getByText("Повторить"));
    expect(await screen.findByTestId("record-title")).toBeOnTheScreen();
  });

  it("cancels the edit", async () => {
    await renderScreens(routes, "/health/records/r-blood");
    await fireEvent.press(await screen.findByText("Редактировать"));
    await fireEvent.press(await screen.findByText("Отмена"));
    expect(await screen.findByText("Натощак")).toBeOnTheScreen();
  });
});
