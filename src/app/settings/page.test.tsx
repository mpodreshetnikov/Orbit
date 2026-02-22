import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SettingsPage from "./page";

const hookMocks = vi.hoisted(() => ({
  useUserPreferences: vi.fn(),
  useUpdateUserPreferences: vi.fn(),
  usePushSubscribe: vi.fn(),
  usePersons: vi.fn(),
  useNotificationRouting: vi.fn(),
  useUpdateNotificationRouting: vi.fn(),
}));

const updatePreferencesMutateAsync = vi.fn();
const pushSubscribeMutateAsync = vi.fn();
const updateRoutingMutateAsync = vi.fn();

vi.mock("next-intl", () => ({
  useTranslations:
    (namespace?: string) =>
    (key: string): string =>
      namespace ? `${namespace}.${key}` : key,
}));

vi.mock("@/lib/date-locale", () => ({
  useIntlLocale: () => "en-US",
}));

vi.mock("@/hooks", () => ({
  useUserPreferences: (...args: unknown[]) => hookMocks.useUserPreferences(...args),
  useUpdateUserPreferences: (...args: unknown[]) => hookMocks.useUpdateUserPreferences(...args),
  usePushSubscribe: (...args: unknown[]) => hookMocks.usePushSubscribe(...args),
  usePersons: (...args: unknown[]) => hookMocks.usePersons(...args),
  useNotificationRouting: (...args: unknown[]) => hookMocks.useNotificationRouting(...args),
  useUpdateNotificationRouting: (...args: unknown[]) =>
    hookMocks.useUpdateNotificationRouting(...args),
}));

function setNotificationMock(options: {
  permission: NotificationPermission;
  requestPermission?: () => Promise<NotificationPermission>;
}): void {
  const permissionState = { value: options.permission };
  const NotificationMock = vi.fn() as unknown as typeof Notification;
  Object.assign(NotificationMock, {
    requestPermission:
      options.requestPermission ??
      (vi.fn(async () => {
        permissionState.value = "granted";
        return permissionState.value;
      }) as typeof Notification.requestPermission),
  });
  Object.defineProperty(NotificationMock, "permission", {
    configurable: true,
    get: () => permissionState.value,
  });
  Object.defineProperty(globalThis, "Notification", {
    configurable: true,
    writable: true,
    value: NotificationMock,
  });
}

function setServiceWorkerMock(options: {
  getRegistrationResult: ServiceWorkerRegistration | null;
  registerResult?: ServiceWorkerRegistration | null;
  subscribeResult?: { endpoint: string; keys: { p256dh: string; auth: string } };
}) {
  const showNotification = vi.fn().mockResolvedValue(undefined);
  const pushSubscribeResult =
    options.subscribeResult ??
    ({
      endpoint: "https://push.example/sub",
      keys: { p256dh: "p", auth: "a" },
    } as const);
  const registration =
    options.registerResult ??
    ({
      scope: "/",
      showNotification,
      pushManager: {
        subscribe: vi.fn().mockResolvedValue({
          toJSON: () => pushSubscribeResult,
        }),
      },
    } as unknown as ServiceWorkerRegistration);

  const getRegistration = vi.fn().mockResolvedValue(options.getRegistrationResult);
  const register = vi.fn().mockResolvedValue(registration);

  Object.defineProperty(globalThis.navigator, "serviceWorker", {
    configurable: true,
    writable: true,
    value: {
      getRegistration,
      register,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
  });

  return { getRegistration, register, showNotification };
}

describe("SettingsPage", () => {
  beforeEach(() => {
    updatePreferencesMutateAsync.mockReset();
    pushSubscribeMutateAsync.mockReset();
    updateRoutingMutateAsync.mockReset();

    updatePreferencesMutateAsync.mockResolvedValue(undefined);
    pushSubscribeMutateAsync.mockResolvedValue(undefined);
    updateRoutingMutateAsync.mockResolvedValue(undefined);

    hookMocks.useUpdateUserPreferences.mockReturnValue({
      mutateAsync: updatePreferencesMutateAsync,
      isPending: false,
    });
    hookMocks.usePushSubscribe.mockReturnValue({
      mutateAsync: pushSubscribeMutateAsync,
      isPending: false,
    });
    hookMocks.useUpdateNotificationRouting.mockReturnValue({
      mutateAsync: updateRoutingMutateAsync,
      isPending: false,
    });
    hookMocks.useUserPreferences.mockReturnValue({
      data: {
        checkup_notification_time: "09:00:00",
        checkup_notification_timezone: "UTC",
      },
    });
    hookMocks.usePersons.mockReturnValue({ data: [] });
    hookMocks.useNotificationRouting.mockReturnValue({
      data: { userId: "user-1", rows: [] },
    });

    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "test-vapid-key";
  });

  it("shows denied permission state, unsupported SW, and empty routing state", async () => {
    setNotificationMock({ permission: "denied" });
    Object.defineProperty(globalThis.navigator, "serviceWorker", {
      configurable: true,
      writable: true,
      value: undefined,
    });

    render(<SettingsPage />);

    expect(await screen.findByText("settings.pwa.permissionDenied")).toBeInTheDocument();
    expect(screen.getByText("settings.pwa.swNotRegistered")).toBeInTheDocument();
    expect(screen.getByText("settings.pwa.routingNoPersons")).toBeInTheDocument();
  });

  it("registers service worker, requests permission, sends test notification, and saves reminders", async () => {
    setNotificationMock({ permission: "default" });
    const sw = setServiceWorkerMock({ getRegistrationResult: null });

    render(<SettingsPage />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "settings.pwa.registerSW" }));
    await waitFor(() => expect(sw.register).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: "settings.pwa.requestPermission" }));
    await waitFor(() =>
      expect(
        (globalThis.Notification as unknown as { requestPermission: () => Promise<string> })
          .requestPermission,
      ).toHaveBeenCalled(),
    );

    await user.click(screen.getByRole("button", { name: "settings.pwa.sendTestNotification" }));
    await waitFor(() => expect(sw.showNotification).toHaveBeenCalled());

    await user.clear(screen.getByLabelText("settings.pwa.notificationTime"));
    await user.type(screen.getByLabelText("settings.pwa.notificationTime"), "07:45");
    await user.clear(screen.getByLabelText("settings.pwa.notificationTimezone"));
    await user.type(screen.getByLabelText("settings.pwa.notificationTimezone"), "Europe/Warsaw");
    await user.click(screen.getByRole("button", { name: "settings.pwa.saveCheckupReminders" }));

    await waitFor(() => {
      expect(updatePreferencesMutateAsync).toHaveBeenCalledWith({
        checkup_notification_time: "07:45",
        checkup_notification_timezone: "Europe/Warsaw",
      });
    });
  });

  it("toggles per-person routing and saves shared prefix", async () => {
    setNotificationMock({ permission: "granted" });
    setServiceWorkerMock({ getRegistrationResult: null });

    hookMocks.usePersons.mockReturnValue({
      data: [
        { id: "person-own", name: "Me", kind: "human", species: null, auth_user_id: "user-1" },
        { id: "person-shared", name: "Dog", kind: "pet", species: "dog", auth_user_id: "user-2" },
      ],
    });
    hookMocks.useNotificationRouting.mockReturnValue({
      data: {
        userId: "user-1",
        rows: [{ person_id: "person-shared", enabled: false, custom_prefix: "Pet" }],
      },
    });

    const firstRender = render(<SettingsPage />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "settings.pwa.routingDisabled" }));
    await waitFor(() => {
      expect(updateRoutingMutateAsync).toHaveBeenCalledWith({
        person_id: "person-shared",
        enabled: true,
        custom_prefix: "Pet",
      });
    });

    firstRender.unmount();

    hookMocks.useNotificationRouting.mockReturnValue({
      data: {
        userId: "user-1",
        rows: [{ person_id: "person-shared", enabled: true, custom_prefix: "Pet" }],
      },
    });

    render(<SettingsPage />);
    const sharedPrefixInput = document.getElementById(
      "routing-prefix-person-shared",
    ) as HTMLInputElement;
    fireEvent.change(sharedPrefixInput, { target: { value: "Care" } });
    fireEvent.blur(sharedPrefixInput);

    await waitFor(() => {
      expect(updateRoutingMutateAsync).toHaveBeenLastCalledWith({
        person_id: "person-shared",
        enabled: true,
        custom_prefix: "Care",
      });
    });
  });

  it("enables checkup reminders via push subscription and persists reminder settings", async () => {
    setNotificationMock({ permission: "granted" });
    Object.defineProperty(globalThis, "PushManager", {
      configurable: true,
      writable: true,
      value: function PushManagerMock() {
        return null;
      },
    });

    const registration = {
      scope: "/",
      showNotification: vi.fn().mockResolvedValue(undefined),
      pushManager: {
        subscribe: vi.fn().mockResolvedValue({
          toJSON: () => ({
            endpoint: "https://push.example/sub-2",
            keys: { p256dh: "p2", auth: "a2" },
          }),
        }),
      },
    } as unknown as ServiceWorkerRegistration;
    setServiceWorkerMock({
      getRegistrationResult: registration,
      registerResult: registration,
    });

    render(<SettingsPage />);
    const user = userEvent.setup();

    await user.click(
      await screen.findByRole("button", { name: "settings.pwa.enableCheckupReminders" }),
    );

    await waitFor(() => {
      expect(pushSubscribeMutateAsync).toHaveBeenCalledWith({
        endpoint: "https://push.example/sub-2",
        keys: { p256dh: "p2", auth: "a2" },
      });
      expect(updatePreferencesMutateAsync).toHaveBeenCalledWith({
        checkup_notification_time: "09:00",
        checkup_notification_timezone: "UTC",
      });
    });
  });

  it("falls back to Notification constructor when service-worker notification fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    setNotificationMock({ permission: "granted" });

    const registration = {
      scope: "/",
      showNotification: vi.fn().mockRejectedValue(new Error("sw failed")),
      pushManager: {
        subscribe: vi.fn(),
      },
    } as unknown as ServiceWorkerRegistration;
    setServiceWorkerMock({
      getRegistrationResult: registration,
      registerResult: registration,
    });

    render(<SettingsPage />);
    const user = userEvent.setup();

    await user.click(
      await screen.findByRole("button", { name: "settings.pwa.sendTestNotification" }),
    );

    await waitFor(() => {
      const notificationCtor = globalThis.Notification as unknown as { mock: { calls: unknown[] } };
      expect(notificationCtor.mock.calls.length).toBeGreaterThan(0);
    });

    errorSpy.mockRestore();
  });

  it("keeps own-person prefix disabled and sends null custom prefix on toggle", async () => {
    setNotificationMock({ permission: "granted" });
    setServiceWorkerMock({ getRegistrationResult: null });

    hookMocks.usePersons.mockReturnValue({
      data: [
        { id: "person-own", name: "Me", kind: "human", species: null, auth_user_id: "user-1" },
      ],
    });
    hookMocks.useNotificationRouting.mockReturnValue({
      data: {
        userId: "user-1",
        rows: [{ person_id: "person-own", enabled: false, custom_prefix: "ignored" }],
      },
    });

    render(<SettingsPage />);
    const user = userEvent.setup();

    const ownPrefixInput = document.getElementById("routing-prefix-person-own") as HTMLInputElement;
    expect(ownPrefixInput).toBeDisabled();

    await user.click(await screen.findByRole("button", { name: "settings.pwa.routingDisabled" }));
    await waitFor(() => {
      expect(updateRoutingMutateAsync).toHaveBeenCalledWith({
        person_id: "person-own",
        enabled: true,
        custom_prefix: null,
      });
    });
  });
});
