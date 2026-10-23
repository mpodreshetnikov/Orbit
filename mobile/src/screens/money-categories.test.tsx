import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { ActionSheetIOS, Alert, type AlertButton } from "react-native";
import MoneyCategoriesScreen from "@/screens/money-categories-screen";
import MoneyCategoryFormScreen from "@/screens/money-category-form-screen";
import MoneyScreen from "@/screens/money-screen";
import { db, fail, fakeSession, rpcHandlers, seed, setSession } from "../../test/fake-supabase";
import { household, NOW, USER_ID } from "../../test/fixtures";
import { renderScreens } from "../../test/render";

jest.mock("@/lib/supabase", () => jest.requireActual("../../test/fake-supabase"));

const routes = {
  "money/index": MoneyScreen,
  "money/categories/index": MoneyCategoriesScreen,
  "money/categories/form": MoneyCategoryFormScreen,
};

const category = (id: string, changes: Record<string, unknown> = {}) => ({
  id,
  parent_id: null,
  canonical_category_id: "food",
  category_kind: "custom",
  sort_order: 0,
  depth: 1,
  name_en: id,
  name_ru: id,
  slug: id,
  ...changes,
});

const CATEGORIES = [
  category("food", { category_kind: "canonical", name_en: "Food", name_ru: "Еда", depth: 0 }),
  category("home", { category_kind: "canonical", name_en: "Home", name_ru: "Дом", depth: 0 }),
  category("cafe", { name_en: "Cafe", name_ru: "Кафе" }),
  category("coffee", { parent_id: "cafe", depth: 2, name_en: "Coffee" }),
  category("deep", { parent_id: "coffee", depth: 4, name_en: "Deep" }),
];

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, advanceTimers: true });
  seed({ ...household(), money_categories: CATEGORIES });
  rpcHandlers.money_list_transactions_feed = () => [];
  rpcHandlers.money_transaction_feed_summary = () => [];
  setSession(fakeSession(USER_ID));
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

function pickOption(label: string) {
  jest
    .spyOn(ActionSheetIOS, "showActionSheetWithOptions")
    .mockImplementationOnce((options, callback) => callback(options.options.indexOf(label)));
}

async function answerAlert(label: string) {
  const alert = jest.spyOn(Alert, "alert");
  await waitFor(() => expect(alert).toHaveBeenCalled());
  (alert.mock.calls.at(-1)?.[2] as AlertButton[])
    .find((button) => button.text === label)
    ?.onPress?.();
}

async function openList() {
  await renderScreens(routes, "/money");
  await fireEvent.press(await screen.findByText("Категории"));
  await screen.findByText("Cafe");
}

describe("the categories", () => {
  it("are reached from the money tab as a tree, and a new one is saved under its parent", async () => {
    await openList();
    expect(screen.getAllByText("Каноническая")).toHaveLength(2);
    expect(screen.getByText("Кафе · cafe")).toBeOnTheScreen();
    await fireEvent.press(screen.getByLabelText("Добавить категорию"));
    await fireEvent.changeText(await screen.findByLabelText("Название (EN)"), " Bakery ");
    await fireEvent.changeText(screen.getByLabelText("Название (RU)"), "Пекарня");
    await fireEvent.changeText(screen.getByLabelText("Слаг"), "bakery");
    pickOption("Food");
    await fireEvent.press(screen.getByLabelText("Каноническая ветка: Выберите каноническую ветку"));
    pickOption("Coffee");
    await fireEvent.press(screen.getByLabelText("Родительская категория: Без родителя"));
    await fireEvent.press(screen.getByText("Сохранить"));
    await waitFor(() => expect(db.tables.money_categories).toHaveLength(6));
    expect(db.tables.money_categories[5]).toMatchObject({
      name_en: "Bakery",
      category_kind: "custom",
      canonical_category_id: "food",
      parent_id: "coffee",
      depth: 3,
    });
    expect(await screen.findByText("Bakery")).toBeOnTheScreen();
  });

  it("asks for every field", async () => {
    await openList();
    await fireEvent.press(screen.getByLabelText("Добавить категорию"));
    await fireEvent.press(await screen.findByText("Сохранить"));
    expect(screen.getByText("Заполните все поля категории.")).toBeOnTheScreen();
    expect(db.tables.money_categories).toHaveLength(5);
  });

  it("adds a child to a canonical branch from its row", async () => {
    await openList();
    pickOption("Добавить категорию");
    await fireEvent.press(screen.getByText("Home"));
    await fireEvent.changeText(await screen.findByLabelText("Название (EN)"), "Repairs");
    await fireEvent.changeText(screen.getByLabelText("Название (RU)"), "Ремонт");
    await fireEvent.changeText(screen.getByLabelText("Слаг"), "repairs");
    expect(screen.getByLabelText("Каноническая ветка: Home")).toBeOnTheScreen();
    await fireEvent.press(screen.getByText("Сохранить"));
    await waitFor(() =>
      expect(db.tables.money_categories[5]).toMatchObject({
        canonical_category_id: "home",
        parent_id: null,
        depth: 1,
      }),
    );
  });

  it("will not go deeper than four levels", async () => {
    await openList();
    pickOption("Добавить категорию");
    await fireEvent.press(screen.getByText("Deep"));
    const alert = jest.spyOn(Alert, "alert");
    await waitFor(() =>
      expect(alert).toHaveBeenCalledWith("Что-то пошло не так", "Максимальная глубина 4."),
    );
  });

  it("edits a custom category from its row", async () => {
    await openList();
    pickOption("Редактировать");
    await fireEvent.press(screen.getByText("Coffee"));
    const name = await screen.findByLabelText("Название (EN)");
    expect(name.props.value).toBe("Coffee");
    expect(screen.getByLabelText("Родительская категория: Cafe")).toBeOnTheScreen();
    await fireEvent.changeText(name, "Coffee shops");
    await fireEvent.press(screen.getByText("Сохранить"));
    await waitFor(() =>
      expect(db.tables.money_categories[3]).toMatchObject({
        name_en: "Coffee shops",
        parent_id: "cafe",
        depth: 2,
      }),
    );
  });

  it("deletes a leaf once asked, but not one with children", async () => {
    await openList();
    const alert = jest.spyOn(Alert, "alert");
    pickOption("Удалить");
    await fireEvent.press(screen.getByText("Cafe"));
    await waitFor(() =>
      expect(alert).toHaveBeenCalledWith(
        "Что-то пошло не так",
        "Нельзя удалить категорию с дочерними.",
      ),
    );
    alert.mockClear();
    pickOption("Удалить");
    await fireEvent.press(screen.getByText("Deep"));
    await answerAlert("Удалить");
    await waitFor(() => expect(db.tables.money_categories).toHaveLength(4));
  });

  it("says when a delete fails", async () => {
    await openList();
    fail("money_categories");
    pickOption("Удалить");
    await fireEvent.press(screen.getByText("Deep"));
    await answerAlert("Удалить");
    await waitFor(() =>
      expect(Alert.alert).toHaveBeenCalledWith(
        "Что-то пошло не так",
        "money_categories is unavailable",
      ),
    );
  });
});

describe("with nothing to show", () => {
  it("offers to add the first category", async () => {
    db.tables.money_categories = [];
    await renderScreens(routes, "/money/categories");
    expect(await screen.findByText("Добавьте категории для группировки.")).toBeOnTheScreen();
  });

  it("says when the category to edit is not there", async () => {
    await renderScreens(routes, "/money/categories/form?id=gone");
    expect(await screen.findByText("Ничего не найдено")).toBeOnTheScreen();
  });
});
