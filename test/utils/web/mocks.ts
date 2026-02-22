import { vi } from "vitest";
import type { ReactNode } from "react";

export type TranslationValues = Record<string, string | number>;

function applyTemplate(template: string, values: TranslationValues | undefined): string {
  if (!values) return template;
  return Object.entries(values).reduce(
    (message, [key, value]) => message.replaceAll(`{${key}}`, String(value)),
    template,
  );
}

export const routerMock = {
  push: vi.fn<(href: string) => void>(),
  replace: vi.fn<(href: string) => void>(),
  refresh: vi.fn<() => void>(),
  prefetch: vi.fn<(href: string) => Promise<void>>().mockResolvedValue(undefined),
};

let searchParamsState = new URLSearchParams();

export function setSearchParams(params: Record<string, string | null | undefined>): void {
  searchParamsState = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value != null) searchParamsState.set(key, value);
  });
}

export function resetRouterMocks(): void {
  routerMock.push.mockReset();
  routerMock.replace.mockReset();
  routerMock.refresh.mockReset();
  routerMock.prefetch.mockReset();
  routerMock.prefetch.mockResolvedValue(undefined);
  searchParamsState = new URLSearchParams();
}

export function mockNextNavigation(): void {
  vi.doMock("next/navigation", () => ({
    useRouter: () => routerMock,
    useSearchParams: () => searchParamsState,
    usePathname: () => "/",
  }));
}

export function mockNextIntl(messages: Record<string, string> = {}): void {
  vi.doMock("next-intl", () => ({
    useTranslations:
      () =>
      (key: string, values?: TranslationValues): string =>
        applyTemplate(messages[key] ?? key, values),
    useLocale: () => "en",
  }));
}

export const themeMock = {
  theme: "light",
  setTheme: vi.fn<(theme: string) => void>(),
};

export function resetThemeMock(): void {
  themeMock.theme = "light";
  themeMock.setTheme.mockReset();
}

export function mockNextThemes(): void {
  vi.doMock("next-themes", () => ({
    useTheme: () => themeMock,
    ThemeProvider: ({ children }: { children: ReactNode }) => children,
  }));
}

export const toastMock = {
  error: vi.fn<(message: string) => void>(),
  success: vi.fn<(message: string) => void>(),
  warning: vi.fn<(message: string) => void>(),
  info: vi.fn<(message: string) => void>(),
};

export function resetToastMock(): void {
  toastMock.error.mockReset();
  toastMock.success.mockReset();
  toastMock.warning.mockReset();
  toastMock.info.mockReset();
}

export function mockSonner(): void {
  vi.doMock("sonner", () => ({
    toast: toastMock,
  }));
}

export function installNotificationMock(permission: NotificationPermission = "granted"): void {
  const NotificationMock = vi.fn() as unknown as typeof Notification;
  Object.defineProperty(NotificationMock, "permission", {
    configurable: true,
    get: () => permission,
  });
  Object.defineProperty(globalThis, "Notification", {
    configurable: true,
    writable: true,
    value: NotificationMock,
  });
}

export function installServiceWorkerMock(options: { hasController?: boolean } = {}): {
  postMessage: ReturnType<typeof vi.fn>;
  showNotification: ReturnType<typeof vi.fn>;
} {
  const postMessage = vi.fn();
  const showNotification = vi.fn().mockResolvedValue(undefined);
  const controller = options.hasController === false ? undefined : { postMessage };

  Object.defineProperty(globalThis.navigator, "serviceWorker", {
    configurable: true,
    writable: true,
    value: {
      controller,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      getRegistration: vi.fn().mockResolvedValue({ showNotification }),
    },
  });

  return { postMessage, showNotification };
}

export function installCacheMock(): { put: ReturnType<typeof vi.fn> } {
  const put = vi.fn().mockResolvedValue(undefined);
  const open = vi.fn().mockResolvedValue({ put });

  Object.defineProperty(globalThis, "caches", {
    configurable: true,
    writable: true,
    value: { open },
  });

  return { put };
}
