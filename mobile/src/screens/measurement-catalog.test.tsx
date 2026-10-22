import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { ActionSheetIOS, Alert } from "react-native";
import CatalogEntryFormScreen, { catalogColumns } from "@/screens/catalog-entry-form-screen";
import HealthScreen from "@/screens/health-screen";
import MeasurementCatalogScreen from "@/screens/measurement-catalog-screen";
import { db, fail, fakeSession, seed, setSession } from "../../test/fake-supabase";
import { household, NOW, USER_ID } from "../../test/fixtures";
import { renderScreens } from "../../test/render";

jest.mock("@/lib/supabase", () => jest.requireActual("../../test/fake-supabase"));

const routes = {
  "health/index": HealthScreen,
  "health/catalogs/measurements/index": MeasurementCatalogScreen,
  "health/catalogs/measurements/form": CatalogEntryFormScreen,
};

const WEIGHT = {
  id: "cat-weight",
  code: "weight",
  name_ru: "Вес",
  name_en: "Weight",
  unit_ru: "кг",
  unit_en: "kg",
  category: "basic",
  sort_order: 1,
};
const NECK = {
  ...WEIGHT,
  id: "cat-neck",
  code: "neck",
  name_ru: "Шея",
  name_en: "Neck",
  unit_ru: "",
  category: "body",
};

/** Answer the next action sheet with the option labelled so. */
function chooseInSheet(label: string) {
  jest.spyOn(ActionSheetIOS, "showActionSheetWithOptions").mockImplementationOnce((options, cb) => {
    cb(options.options.indexOf(label));
  });
}

/** Press the alert's button labelled so, once the alert is up. */
async function answerAlert(alert: ReturnType<typeof jest.spyOn>, label: string) {
  await waitFor(() => expect(alert).toHaveBeenCalled());
  const buttons = alert.mock.calls.at(-1)?.[2] as { text: string; onPress?: () => void }[];
  buttons.find((button) => button.text === label)?.onPress?.();
}

const field = (label: string) => screen.getByLabelText(label);

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, advanceTimers: true });
  seed({ ...household(), measurement_catalog: [WEIGHT, NECK], measurements: [] });
  setSession(fakeSession(USER_ID));
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe("the measurement catalogue", () => {
  it("is reached from the health menu and lists every type by category", async () => {
    await renderScreens(routes, "/health");
    await fireEvent.press(await screen.findByLabelText("Каталог измерений"));

    expect(await screen.findByText("ОСНОВНЫЕ")).toBeOnTheScreen();
    expect(screen.getByText("ТЕЛО")).toBeOnTheScreen();
    expect(screen.getByText("weight · Weight")).toBeOnTheScreen();
    expect(screen.getByText("neck · Neck")).toBeOnTheScreen();
  });

  it("says when it is empty", async () => {
    db.tables.measurement_catalog = [];
    await renderScreens(routes, "/health/catalogs/measurements");
    expect(await screen.findByText("Нет типов измерений в каталоге")).toBeOnTheScreen();
  });

  it("offers a retry when it cannot be read", async () => {
    fail("measurement_catalog");
    await renderScreens(routes, "/health/catalogs/measurements");
    expect(await screen.findByText("measurement_catalog is unavailable")).toBeOnTheScreen();
    db.failing.clear();
    await fireEvent.press(screen.getByText("Повторить"));
    expect(await screen.findByText("weight · Weight")).toBeOnTheScreen();
  });

  it("adds a type the way the web dialog saves it", async () => {
    await renderScreens(routes, "/health/catalogs/measurements");
    await fireEvent.press(await screen.findByLabelText("Добавить тип измерения"));

    // Code and both names are required.
    await fireEvent.press(await screen.findByText("Сохранить"));
    expect(screen.getAllByText("Обязательное поле")).toHaveLength(3);

    await fireEvent.changeText(field("Код"), " Hip_Left ");
    await fireEvent.changeText(field("Название (RU)"), "Левое бедро ");
    await fireEvent.changeText(field("Название (EN)"), "Left hip");
    await fireEvent.changeText(field("Единица (RU)"), "см");
    await fireEvent.changeText(field("Порядок сортировки"), "7");
    chooseInSheet("Конечности");
    await fireEvent.press(screen.getByLabelText(/^Категория/));
    await fireEvent.press(screen.getByText("Сохранить"));

    await waitFor(() =>
      expect(db.tables.measurement_catalog.at(-1)).toMatchObject({
        code: "hip_left",
        name_ru: "Левое бедро",
        name_en: "Left hip",
        unit_ru: "см",
        unit_en: "",
        category: "limbs",
        sort_order: 7,
      }),
    );
    expect(await screen.findByText("КОНЕЧНОСТИ")).toBeOnTheScreen();
  });

  it("edits a type from its menu", async () => {
    await renderScreens(routes, "/health/catalogs/measurements");
    chooseInSheet("Редактировать");
    await fireEvent.press(await screen.findByLabelText("Шея neck"));

    expect((await screen.findByLabelText("Название (EN)")).props.value).toBe("Neck");
    await fireEvent.changeText(field("Единица (RU)"), "см");
    await fireEvent.press(screen.getByText("Сохранить"));

    await waitFor(() =>
      expect(db.tables.measurement_catalog.find((row) => row.id === "cat-neck")?.unit_ru).toBe(
        "см",
      ),
    );
  });

  it("says when the type to edit is gone", async () => {
    await renderScreens(routes, "/health/catalogs/measurements/form?id=gone");
    expect(await screen.findByText("Ничего не найдено")).toBeOnTheScreen();
  });

  it("deletes a type after asking, and shows the refusal when it cannot", async () => {
    await renderScreens(routes, "/health/catalogs/measurements");
    const alert = jest.spyOn(Alert, "alert");
    chooseInSheet("Удалить");
    await fireEvent.press(await screen.findByLabelText("Шея neck"));
    expect(alert.mock.calls.length).toBe(0);
    await answerAlert(alert, "Удалить");
    expect(alert.mock.calls[0][1]).toBe(
      'Вы уверены, что хотите удалить "neck"? Это действие нельзя отменить.',
    );
    await waitFor(() =>
      expect(db.tables.measurement_catalog.map((row) => row.id)).toEqual(["cat-weight"]),
    );

    fail("measurement_catalog");
    chooseInSheet("Удалить");
    await fireEvent.press(screen.getByLabelText("Вес weight"));
    await waitFor(() => expect(alert).toHaveBeenCalledTimes(2));
    await answerAlert(alert, "Удалить");
    await waitFor(() =>
      expect(alert).toHaveBeenLastCalledWith(
        "Что-то пошло не так",
        "measurement_catalog is unavailable",
      ),
    );
  });

  it("keeps the form when the save fails", async () => {
    await renderScreens(routes, "/health/catalogs/measurements/form?id=cat-weight");
    const alert = jest.spyOn(Alert, "alert");
    await screen.findByLabelText("Код");
    fail("measurement_catalog");
    await fireEvent.press(screen.getByText("Сохранить"));
    await waitFor(() =>
      expect(alert).toHaveBeenCalledWith(
        "Что-то пошло не так",
        "measurement_catalog is unavailable",
      ),
    );
    expect(field("Код")).toBeOnTheScreen();
  });
});

describe("catalogColumns", () => {
  it("trims every text and lowers the code", () => {
    expect(
      catalogColumns({ ...WEIGHT, code: " Waist ", unit_en: " cm ", category: "body" }),
    ).toMatchObject({
      code: "waist",
      unit_en: "cm",
    });
  });
});
