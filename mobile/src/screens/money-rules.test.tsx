import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { ActionSheetIOS, Alert, type AlertButton } from "react-native";
import MoneyRuleFormScreen from "@/screens/money-rule-form-screen";
import MoneyRulesScreen from "@/screens/money-rules-screen";
import MoneyScreen from "@/screens/money-screen";
import {
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

const routes = {
  "money/index": MoneyScreen,
  "money/rules/index": MoneyRulesScreen,
  "money/rules/form": MoneyRuleFormScreen,
};

const rule = (id: string, sort_order: number, changes: Record<string, unknown> = {}) => ({
  id,
  person_id: PERSON.id,
  name: id,
  description: null,
  enabled: true,
  sort_order,
  rule_kind: "direct",
  target_category_id: null,
  match_mode: "all",
  scope_filter: "all_line_items",
  filters: [],
  config: {},
  stop_processing: false,
  created_at: "2026-01-01T09:00:00Z",
  ...changes,
});

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, advanceTimers: true });
  seed({
    ...household(),
    money_categories: [
      {
        id: "other",
        name_en: "Other",
        name_ru: "Прочее",
        system_key: "uncategorized",
        category_kind: "canonical",
        depth: 0,
      },
      {
        id: "cafe",
        name_en: "Cafe",
        name_ru: "Кафе",
        system_key: null,
        category_kind: "custom",
        depth: 1,
      },
    ],
    money_category_rules: [
      rule("Кофе", 1, {
        description: "Кофейни",
        target_category_id: "cafe",
        filters: [{ field: "merchant_name", operator: "contains", value: "coffee" }],
      }),
      rule("MCC", 2, { rule_kind: "mcc_map", enabled: false, match_mode: "any" }),
      rule("Чужое", 1, { person_id: "someone-else" }),
    ],
  });
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

const order = () =>
  Object.fromEntries(db.tables.money_category_rules.map((one) => [one.id, one.sort_order]));

describe("the rules", () => {
  it("are reached from the money tab, in order, each described", async () => {
    await renderScreens(routes, "/money");
    await fireEvent.press(await screen.findByText("Правила"));
    expect(await screen.findByText("Кофе")).toBeOnTheScreen();
    expect(screen.queryByText("Чужое")).toBeNull();
    expect(screen.getByText("Прямое правило")).toBeOnTheScreen();
    expect(screen.getByText("Выключено")).toBeOnTheScreen();
    expect(screen.getByText("Кофейни")).toBeOnTheScreen();
    expect(screen.getByText("Мерчант Содержит 'coffee'")).toBeOnTheScreen();
    expect(screen.getByText("Все строки · Все фильтры · Cafe / Кафе")).toBeOnTheScreen();
    expect(screen.getByText("Все строки · Любой фильтр")).toBeOnTheScreen();
  });

  it("move down and up the order", async () => {
    await renderScreens(routes, "/money/rules");
    pickOption("Опустить ниже");
    await fireEvent.press(await screen.findByLabelText("Действия: Кофе"));
    await waitFor(() => expect(order()).toMatchObject({ Кофе: 2, MCC: 1 }));
    await waitFor(() =>
      expect(screen.getAllByText(/^(Кофе|MCC)$/).map((one) => one.props.children)).toEqual([
        "MCC",
        "Кофе",
      ]),
    );
    pickOption("Поднять выше");
    await fireEvent.press(screen.getByLabelText("Действия: Кофе"));
    await waitFor(() => expect(order()).toMatchObject({ Кофе: 1, MCC: 2 }));
  });

  it("change one at a time: a move picked while another is saving is dropped", async () => {
    await renderScreens(routes, "/money/rules");
    const from = supabase.from.bind(supabase);
    let updates = 0;
    jest.spyOn(supabase, "from").mockImplementation(((name: string) => {
      const builder = from(name);
      const update = builder.update.bind(builder);
      builder.update = ((...args: Parameters<typeof update>) => {
        updates += 1;
        return update(...args);
      }) as typeof builder.update;
      return builder;
    }) as typeof supabase.from);
    jest
      .spyOn(ActionSheetIOS, "showActionSheetWithOptions")
      .mockImplementationOnce((options, pick) => {
        const down = options.options.indexOf("Опустить ниже");
        pick(down);
        pick(down);
      });
    await fireEvent.press(await screen.findByLabelText("Действия: Кофе"));
    await waitFor(() => expect(order()).toMatchObject({ Кофе: 2, MCC: 1 }));
    await waitFor(() => expect(screen.getByLabelText("Действия: Кофе")).toBeEnabled());
    // Two rules, each parked and then placed: four writes for the one move that ran.
    expect(updates).toBe(4);
  });

  it("say when the person cannot be read, and try again", async () => {
    fail("persons");
    await renderScreens(routes, "/money/rules");
    expect(await screen.findByText("persons is unavailable")).toBeOnTheScreen();
    db.failing.clear();
    await fireEvent.press(screen.getByText("Повторить"));
    expect(await screen.findByText("Кофе")).toBeOnTheScreen();
  });

  it("are deleted once asked, and say when that fails", async () => {
    await renderScreens(routes, "/money/rules");
    const alert = jest.spyOn(Alert, "alert");
    const answer = async (label: string) => {
      await waitFor(() => expect(alert).toHaveBeenCalled());
      (alert.mock.calls.at(-1)?.[2] as AlertButton[])
        .find((button) => button.text === label)
        ?.onPress?.();
    };
    pickOption("Удалить");
    await fireEvent.press(await screen.findByLabelText("Действия: MCC"));
    await answer("Удалить");
    await waitFor(() => expect(db.tables.money_category_rules).toHaveLength(2));

    alert.mockClear();
    fail("money_category_rules");
    pickOption("Удалить");
    await fireEvent.press(screen.getByLabelText("Действия: Кофе"));
    await answer("Удалить");
    await waitFor(() =>
      expect(alert).toHaveBeenCalledWith(
        "Что-то пошло не так",
        "money_category_rules is unavailable",
      ),
    );
  });

  it("say when there are none", async () => {
    db.tables.money_category_rules = [];
    await renderScreens(routes, "/money/rules");
    expect(
      await screen.findByText("Создайте первое правило для выбранной персоны."),
    ).toBeOnTheScreen();
  });
});

describe("the rule form", () => {
  async function openNew() {
    await renderScreens(routes, "/money/rules");
    await fireEvent.press(await screen.findByLabelText("Добавить правило"));
    await screen.findByLabelText("Название правила");
  }

  it("saves a new direct rule with its filters, last in the order", async () => {
    await openNew();
    await fireEvent.changeText(screen.getByLabelText("Название правила"), " Такси ");
    await fireEvent.changeText(screen.getByLabelText("Описание"), "Поездки");
    pickOption("  Кафе");
    await fireEvent.press(screen.getByLabelText("Целевая категория: Выберите категорию"));
    pickOption("Любой фильтр");
    await fireEvent.press(screen.getByLabelText("Режим совпадения: Все фильтры"));
    pickOption("Только без категории");
    await fireEvent.press(screen.getByLabelText("Ограничение области: Все строки"));
    expect(screen.getByText(/^Фильтры не добавлены/)).toBeOnTheScreen();

    await fireEvent.press(screen.getByText("Добавить фильтр"));
    pickOption("Содержит любое из набора");
    await fireEvent.press(screen.getByLabelText("Оператор 1: Содержит"));
    await fireEvent.changeText(screen.getByLabelText("Значения 1"), "Yandex, Uber");

    await fireEvent.press(screen.getByText("Добавить фильтр"));
    pickOption("Сумма строки");
    await fireEvent.press(screen.getByLabelText("Поле 2: Мерчант"));
    pickOption("Диапазон");
    await fireEvent.press(screen.getByLabelText("Оператор 2: Содержит"));
    expect(screen.getByText(/^Минимум и максимум включаются/)).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByLabelText("Минимум 2"), "1,5x");
    await fireEvent.changeText(screen.getByLabelText("Максимум 2"), "-100");

    await fireEvent.press(screen.getByText("Добавить фильтр"));
    pickOption("Пусто");
    await fireEvent.press(screen.getByLabelText("Оператор 3: Содержит"));
    await fireEvent.press(screen.getByText("Добавить фильтр"));
    await fireEvent.press(screen.getByLabelText("Удалить фильтр 4"));

    await fireEvent(
      screen.getByLabelText("Остановить пайплайн после изменения категории"),
      "valueChange",
      true,
    );
    await fireEvent(screen.getByLabelText("Включено"), "valueChange", false);
    await fireEvent.press(screen.getByText("Сохранить"));

    await waitFor(() => expect(db.tables.money_category_rules).toHaveLength(4));
    expect(db.tables.money_category_rules[3]).toMatchObject({
      person_id: PERSON.id,
      sort_order: 3,
      name: "Такси",
      description: "Поездки",
      enabled: false,
      rule_kind: "direct",
      target_category_id: "cafe",
      match_mode: "any",
      scope_filter: "uncategorized_only",
      stop_processing: true,
      filters: [
        { field: "merchant_name", operator: "contains_any_in_set", values: ["Yandex", "Uber"] },
        { field: "line_item_amount", operator: "range", min: 15, max: -100 },
        { field: "merchant_name", operator: "is_empty" },
      ],
    });
    expect(await screen.findByText("Такси")).toBeOnTheScreen();
  });

  it("names what stops a save", async () => {
    await openNew();
    await fireEvent.press(screen.getByText("Сохранить"));
    expect(screen.getByText("Название правила обязательно.")).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByLabelText("Название правила"), "Такси");
    await fireEvent.press(screen.getByText("Сохранить"));
    expect(screen.getByText("Для прямого правила нужна целевая категория.")).toBeOnTheScreen();
    pickOption("MCC-маппинг");
    await fireEvent.press(screen.getByLabelText("Тип правила: Прямое правило"));
    await fireEvent.press(screen.getByText("Добавить фильтр"));
    pickOption("Регулярное выражение");
    await fireEvent.press(screen.getByLabelText("Оператор 1: Содержит"));
    await fireEvent.changeText(screen.getByLabelText("Значение 1"), "(");
    await fireEvent.press(screen.getByText("Сохранить"));
    expect(screen.getByText("Регулярное выражение указано некорректно.")).toBeOnTheScreen();
    expect(db.tables.money_category_rules).toHaveLength(3);
  });

  it("edits a rule from its menu: a smart one's prompt, a fallback's category", async () => {
    await renderScreens(routes, "/money/rules");
    pickOption("Редактировать");
    await fireEvent.press(await screen.findByLabelText("Действия: Кофе"));
    const name = await screen.findByLabelText("Название правила");
    expect(name.props.value).toBe("Кофе");
    expect(screen.getByLabelText("Значение 1").props.value).toBe("coffee");
    pickOption("LLM-категоризация");
    await fireEvent.press(screen.getByLabelText("Тип правила: Прямое правило"));
    await fireEvent.changeText(screen.getByLabelText("Промпт для LLM"), "Кофе?");
    pickOption("Fallback без категории");
    await fireEvent.press(screen.getByLabelText("Тип правила: LLM-категоризация"));
    pickOption("Other / Прочее (uncategorized)");
    await fireEvent.press(
      screen.getByLabelText("Каноническая fallback-категория: Other / Прочее (uncategorized)"),
    );
    await fireEvent.press(screen.getByText("Сохранить"));
    await waitFor(() =>
      expect(db.tables.money_category_rules[0]).toMatchObject({
        rule_kind: "fallback_uncategorized",
        target_category_id: null,
        config: { target_system_key: "uncategorized" },
      }),
    );
  });

  it("says when saving fails, and when the rule is not there", async () => {
    await renderScreens(routes, "/money/rules");
    pickOption("Редактировать");
    await fireEvent.press(await screen.findByLabelText("Действия: MCC"));
    await screen.findByLabelText("Название правила");
    fail("money_category_rules");
    const alert = jest.spyOn(Alert, "alert");
    await fireEvent.press(screen.getByText("Сохранить"));
    await waitFor(() =>
      expect(alert).toHaveBeenCalledWith(
        "Что-то пошло не так",
        "money_category_rules is unavailable",
      ),
    );
  });

  it.each(["persons", "money_categories"])(
    "says when %s cannot be read, and opens once tried again",
    async (table) => {
      fail(table);
      await renderScreens(routes, "/money/rules/form");
      expect(await screen.findByText(`${table} is unavailable`)).toBeOnTheScreen();
      db.failing.clear();
      await fireEvent.press(screen.getByText("Повторить"));
      expect(await screen.findByLabelText("Название правила")).toBeOnTheScreen();
    },
  );

  it("says when the rule to edit is not there", async () => {
    await renderScreens(routes, "/money/rules/form?id=gone");
    expect(await screen.findByText("Ничего не найдено")).toBeOnTheScreen();
  });
});
