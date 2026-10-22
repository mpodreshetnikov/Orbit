import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { ActionSheetIOS, Alert } from "react-native";
import BodySiteForm from "@/app/(tabs)/health/catalogs/body-sites/form";
import BodySites from "@/app/(tabs)/health/catalogs/body-sites/index";
import FindingTypeForm from "@/app/(tabs)/health/catalogs/finding-types/form";
import FindingTypes from "@/app/(tabs)/health/catalogs/finding-types/index";
import { clinicalColumns } from "@/screens/clinical-catalog-form-screen";
import HealthScreen from "@/screens/health-screen";
import { db, fail, fakeSession, seed, setSession } from "../../test/fake-supabase";
import { household, NOW, USER_ID } from "../../test/fixtures";
import { renderScreens } from "../../test/render";

jest.mock("@/lib/supabase", () => jest.requireActual("../../test/fake-supabase"));

const routes = {
  "health/index": HealthScreen,
  "health/catalogs/finding-types/index": FindingTypes,
  "health/catalogs/finding-types/form": FindingTypeForm,
  "health/catalogs/body-sites/index": BodySites,
  "health/catalogs/body-sites/form": BodySiteForm,
};

const POLYP = {
  id: "ft-polyp",
  finding_code: "polyp",
  name_ru: "Полип",
  name_en: "Polyp",
  synonyms_ru: ["нарост", "полипоз", "образование", "вырост"],
  synonyms_en: [],
  notes: null,
};
const CYST = {
  ...POLYP,
  id: "ft-cyst",
  finding_code: "cyst",
  name_ru: "Киста",
  name_en: "Cyst",
  synonyms_ru: [],
};

function site(id: string, name: string, parent: string | null = null) {
  return {
    id,
    site_code: id,
    name_ru: name,
    name_en: id,
    parent_site_code: parent,
    synonyms_ru: [],
    synonyms_en: [],
    notes: null,
  };
}

/** Answer the next action sheet with the option labelled so. */
function chooseInSheet(label: string) {
  jest.spyOn(ActionSheetIOS, "showActionSheetWithOptions").mockImplementationOnce((options, cb) => {
    cb(options.options.indexOf(label));
  });
}

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, advanceTimers: true });
  seed({
    ...household(),
    finding_type_catalog: [POLYP, CYST],
    body_site_catalog: [
      site("abdomen", "Живот"),
      site("kidney", "Почка", "abdomen"),
      site("kidney_left", "Левая почка", "kidney"),
    ],
  });
  setSession(fakeSession(USER_ID));
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe("the finding types", () => {
  it("are reached from the health menu, by code, with their first synonyms", async () => {
    await renderScreens(routes, "/health");
    await fireEvent.press(await screen.findByLabelText("Типы находок"));
    expect(await screen.findByText("cyst · Cyst")).toBeOnTheScreen();
    const names = screen.getAllByText(/^(Киста|Полип)$/).map((one) => one.props.children);
    expect(names).toEqual(["Киста", "Полип"]);
    expect(screen.getByText("нарост")).toBeOnTheScreen();
    expect(screen.queryByText("вырост")).toBeNull();
    expect(screen.getByText("+1")).toBeOnTheScreen();
  });

  it("say when there are none", async () => {
    db.tables.finding_type_catalog = [];
    await renderScreens(routes, "/health/catalogs/finding-types");
    expect(await screen.findByText("Нет элементов в каталоге")).toBeOnTheScreen();
  });

  it("offer a retry when they cannot be read", async () => {
    fail("finding_type_catalog");
    await renderScreens(routes, "/health/catalogs/finding-types");
    expect(await screen.findByText("finding_type_catalog is unavailable")).toBeOnTheScreen();
    db.failing.clear();
    await fireEvent.press(screen.getByText("Повторить"));
    expect(await screen.findByText("Полип")).toBeOnTheScreen();
  });

  it("gain one with its synonyms and notes, the code lower-cased", async () => {
    await renderScreens(routes, "/health/catalogs/finding-types");
    await fireEvent.press(await screen.findByLabelText("Добавить тип находки"));
    await fireEvent.press(await screen.findByText("Сохранить"));
    expect(screen.getAllByText("Обязательное поле")).toHaveLength(3);

    await fireEvent.changeText(screen.getByLabelText("Код"), " Stone ");
    await fireEvent.changeText(screen.getByLabelText("Название (RU)"), "Камень");
    await fireEvent.changeText(screen.getByLabelText("Название (EN)"), "Stone");
    await fireEvent.changeText(screen.getByLabelText("Синонимы (RU)"), "Конкремент");
    await fireEvent.press(screen.getByLabelText("Синонимы (RU): Добавить"));
    await fireEvent.changeText(screen.getByLabelText("Синонимы (RU)"), "конкремент");
    await fireEvent.press(screen.getByLabelText("Синонимы (RU): Добавить"));
    await fireEvent.changeText(screen.getByLabelText("Синонимы (EN)"), "calculus");
    await fireEvent(screen.getByLabelText("Синонимы (EN)"), "submitEditing");
    await fireEvent.changeText(screen.getByLabelText("Синонимы (EN)"), "stone");
    await fireEvent(screen.getByLabelText("Синонимы (EN)"), "submitEditing");
    await fireEvent.press(screen.getByLabelText("Удалить stone"));
    await fireEvent.changeText(screen.getByLabelText("Заметки"), " В почках ");
    await fireEvent.press(screen.getByText("Сохранить"));

    await waitFor(() => expect(db.tables.finding_type_catalog).toHaveLength(3));
    expect(db.tables.finding_type_catalog[2]).toMatchObject({
      finding_code: "stone",
      name_ru: "Камень",
      synonyms_ru: ["конкремент"],
      synonyms_en: ["calculus"],
      notes: "В почках",
    });
    expect(await screen.findByText("stone · Stone")).toBeOnTheScreen();
  });

  it("change one from its menu", async () => {
    await renderScreens(routes, "/health/catalogs/finding-types");
    chooseInSheet("Редактировать");
    await fireEvent.press(await screen.findByLabelText("Киста cyst"));
    const name = await screen.findByLabelText("Название (RU)");
    expect(name.props.value).toBe("Киста");
    await fireEvent.changeText(name, "Киста простая");
    await fireEvent.press(screen.getByText("Сохранить"));
    await waitFor(() =>
      expect(db.tables.finding_type_catalog[1]).toMatchObject({
        name_ru: "Киста простая",
        notes: null,
      }),
    );
  });

  it("lose one once the delete is confirmed, and say when that fails", async () => {
    await renderScreens(routes, "/health/catalogs/finding-types");
    const alert = jest.spyOn(Alert, "alert");
    fail("finding_type_catalog");
    chooseInSheet("Удалить");
    await fireEvent.press(await screen.findByLabelText("Полип polyp"));
    await waitFor(() => expect(alert).toHaveBeenCalled());
    expect(alert.mock.calls[0][1]).toBe(
      'Вы уверены, что хотите удалить "Полип"? Это действие нельзя отменить.',
    );
    const buttons = alert.mock.calls[0][2] as { text: string; onPress?: () => void }[];
    buttons.find((button) => button.text === "Удалить")?.onPress?.();
    await waitFor(() =>
      expect(alert).toHaveBeenCalledWith(
        "Что-то пошло не так",
        "finding_type_catalog is unavailable",
      ),
    );
    db.failing.clear();
    buttons.find((button) => button.text === "Удалить")?.onPress?.();
    await waitFor(() =>
      expect(db.tables.finding_type_catalog.map((row) => row.id)).toEqual(["ft-cyst"]),
    );
  });

  it("say when the one to edit is not there", async () => {
    await renderScreens(routes, "/health/catalogs/finding-types/form?id=gone");
    expect(await screen.findByText("Ничего не найдено")).toBeOnTheScreen();
  });
});

describe("the body sites", () => {
  it("show their parent, and take one picked by search but never one under them", async () => {
    await renderScreens(routes, "/health/catalogs/body-sites");
    expect(await screen.findByText("kidney · kidney · ↳ abdomen")).toBeOnTheScreen();
    chooseInSheet("Редактировать");
    await fireEvent.press(screen.getByLabelText("Почка kidney"));
    expect(await screen.findByText("Живот (abdomen)")).toBeOnTheScreen();

    await fireEvent.changeText(
      screen.getByLabelText("Выберите родительскую локализацию..."),
      "почка",
    );
    expect(screen.getByText("Ничего не найдено.")).toBeOnTheScreen();
    await fireEvent.press(screen.getByLabelText("Нет родителя (верхний уровень)"));
    expect(screen.getByText("Нет родителя (верхний уровень)")).toBeOnTheScreen();
    await fireEvent.press(screen.getByText("Сохранить"));
    await waitFor(() => expect(db.tables.body_site_catalog[1].parent_site_code).toBeNull());
  });

  it("gain one under a parent found by name", async () => {
    await renderScreens(routes, "/health/catalogs/body-sites");
    await fireEvent.press(await screen.findByLabelText("Добавить локализацию"));
    await fireEvent.changeText(await screen.findByLabelText("Код"), "kidney_right");
    await fireEvent.changeText(screen.getByLabelText("Название (RU)"), "Правая почка");
    await fireEvent.changeText(screen.getByLabelText("Название (EN)"), "Right kidney");
    await fireEvent.changeText(
      screen.getByLabelText("Выберите родительскую локализацию..."),
      "поч",
    );
    await fireEvent.press(screen.getByText("Почка"));
    expect(screen.getByText("Почка (kidney)")).toBeOnTheScreen();
    await fireEvent.press(screen.getByText("Сохранить"));
    await waitFor(() =>
      expect(db.tables.body_site_catalog[3]).toMatchObject({
        site_code: "kidney_right",
        parent_site_code: "kidney",
        notes: null,
      }),
    );
  });
});

describe("clinicalColumns", () => {
  it("trims, lower-cases the code and drops an empty parent and notes", () => {
    expect(
      clinicalColumns({
        code: " A ",
        name_ru: " Б ",
        name_en: " C ",
        parent_code: "",
        synonyms_ru: [],
        synonyms_en: [],
        notes: " ",
      }),
    ).toEqual({
      code: "a",
      name_ru: "Б",
      name_en: "C",
      parent_code: null,
      synonyms_ru: [],
      synonyms_en: [],
      notes: null,
    });
  });
});
