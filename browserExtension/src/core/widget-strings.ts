/**
 * Every string the source-page widget shows, in each language the app speaks.
 *
 * The widget runs inside the bank's page and has no access to the app's translations, so it
 * carries its own. The app tells it which language to use through the session (`locale`), the
 * same cookie-backed choice `src/i18n/request.ts` resolves for the app itself; failing that, the
 * browser's language decides. Until this existed the widget spoke English whatever the app was
 * set to, which is what the first live run reported.
 *
 * Both tables are typed against one key list, so a string added to one language and not the
 * other is a compile error rather than an English fallback nobody notices.
 */

export type WidgetLocale = "en" | "ru";
export const WIDGET_LOCALES: readonly WidgetLocale[] = ["en", "ru"];

export type WidgetStringKey =
  | "title"
  | "progress"
  | "run"
  | "running"
  | "retry"
  | "statusRunning"
  | "statusFailed"
  | "statusReviewReady"
  | "statusCompleted"
  | "statusReady"
  | "session"
  | "noActiveSession"
  | "parsedTransactions"
  | "batch"
  | "receiptRequests"
  | "fullModeCompleted"
  | "fullModeEta"
  | "fullModeWaiting"
  | "fullModePending"
  | "phaseIdle"
  | "runtimeUnavailable";

const STRINGS: Record<WidgetLocale, Record<WidgetStringKey, string>> = {
  en: {
    title: "Money import",
    progress: "Progress",
    run: "Run import",
    running: "Import running...",
    retry: "Retry",
    statusRunning: "Import is running",
    statusFailed: "Import failed",
    statusReviewReady: "Preview ready for review",
    statusCompleted: "Import completed",
    statusReady: "Ready to run",
    session: "Session",
    noActiveSession: "no active session",
    parsedTransactions: "Parsed transactions",
    batch: "Batch",
    receiptRequests: "Receipt detail requests",
    fullModeCompleted: "Full mode ETA: completed",
    fullModeEta: "Full mode ETA",
    fullModeWaiting: "Full mode status: waiting for source cooldown or pending detail response",
    fullModePending:
      "Full mode ETA appears after the bank counts transactions in the selected range",
    phaseIdle: "Idle",
    runtimeUnavailable: "Extension runtime is unavailable",
  },
  ru: {
    title: "Импорт операций",
    progress: "Прогресс",
    run: "Запустить импорт",
    running: "Импорт идёт…",
    retry: "Повторить",
    statusRunning: "Импорт выполняется",
    statusFailed: "Импорт не удался",
    statusReviewReady: "Предпросмотр готов к проверке",
    statusCompleted: "Импорт завершён",
    statusReady: "Готов к запуску",
    session: "Сессия",
    noActiveSession: "нет активной сессии",
    parsedTransactions: "Разобрано операций",
    batch: "Партия",
    receiptRequests: "Запросов деталей чеков",
    fullModeCompleted: "Полный режим: завершено",
    fullModeEta: "Полный режим, осталось",
    fullModeWaiting: "Полный режим: ждём паузу банка или ответ по деталям",
    fullModePending: "Оценка времени появится, когда банк посчитает операции за выбранный период",
    phaseIdle: "Ожидание",
    runtimeUnavailable: "Расширение недоступно",
  },
};

const PHASES: Record<WidgetLocale, Record<string, string>> = {
  en: {
    starting: "Starting import",
    parse_preparing_tab: "Preparing bank tab",
    parse_loading_operations_page: "Opening operations page",
    parse_extracting_page_data: "Starting page extraction",
    parse_discovering_endpoints: "Discovering bank endpoints",
    parse_fetching_ranges: "Loading transaction ranges",
    parse_enriching_operations: "Loading transaction details",
    parse_using_dom_fallback: "Using page fallback",
    parse_dom_rows_ready: "Fallback rows ready",
    parse_mapping_rows: "Mapping parsed rows",
    parse_completed: "Parsing completed",
    preview_rows_started: "Preparing preview",
    complete_session_started: "Finalizing import",
    parse_only_completed: "Parse-only completed",
    review_ready: "Preview ready for review",
    completed: "Import completed",
  },
  ru: {
    starting: "Запуск импорта",
    parse_preparing_tab: "Подготовка вкладки банка",
    parse_loading_operations_page: "Открываем страницу операций",
    parse_extracting_page_data: "Начинаем извлечение данных",
    parse_discovering_endpoints: "Ищем точки входа банка",
    parse_fetching_ranges: "Загружаем диапазоны операций",
    parse_enriching_operations: "Загружаем детали операций",
    parse_using_dom_fallback: "Запасной разбор страницы",
    parse_dom_rows_ready: "Запасные строки готовы",
    parse_mapping_rows: "Сопоставляем строки",
    parse_completed: "Разбор завершён",
    preview_rows_started: "Готовим предпросмотр",
    complete_session_started: "Завершаем импорт",
    parse_only_completed: "Только разбор завершён",
    review_ready: "Предпросмотр готов",
    completed: "Импорт завершён",
  },
};

export function isWidgetLocale(value: unknown): value is WidgetLocale {
  return value === "en" || value === "ru";
}

/**
 * The session's `locale` wins, because it is the language the app is actually showing; the
 * browser's language is the fallback for a session that predates the field.
 */
export function resolveWidgetLocale(
  session: Record<string, unknown> | null,
  navigatorLanguage: string | undefined,
): WidgetLocale {
  if (isWidgetLocale(session?.locale)) return session.locale;
  if (typeof navigatorLanguage === "string" && /^ru\b/i.test(navigatorLanguage)) return "ru";
  return "en";
}

export function widgetText(locale: WidgetLocale, key: WidgetStringKey): string {
  return STRINGS[locale][key];
}

/** A phase the table does not know is shown as its own name, spaces for underscores. */
export function widgetPhaseLabel(locale: WidgetLocale, phase: string | null): string {
  if (!phase) return STRINGS[locale].phaseIdle;
  return PHASES[locale][phase] ?? phase.replace(/_/g, " ");
}

/** Exposed for the test that proves every phase is named in every language. */
export function knownWidgetPhases(locale: WidgetLocale): string[] {
  return Object.keys(PHASES[locale]);
}
