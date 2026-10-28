import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { findBrowserGrantId, MoneyImportGrants } from "./import-grants";

const mocks = vi.hoisted(() => ({
  grants: [] as unknown[],
  createGrant: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() },
}));

vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("@/hooks/use-money-import-grants", () => ({
  useMoneyImportGrants: () => ({
    data: mocks.grants,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useCreateMoneyImportGrant: () => ({ mutateAsync: mocks.createGrant, isPending: false }),
  useRevokeMoneyImportGrant: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

const t = (key: string, values?: Record<string, string | number>) =>
  values ? `${key} ${Object.values(values).join(" ")}` : key;

function panel(personId: string, onSendToExtension: (grant: unknown) => Promise<boolean>) {
  return (
    <MoneyImportGrants
      t={t}
      personId={personId}
      availableSources={[{ sourceId: "tbank_web", label: "T-Bank" }]}
      onSendToExtension={onSendToExtension}
    />
  );
}

async function pressIssue(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByPlaceholderText("money.importGrantLabelPlaceholder"), "home laptop");
  await user.click(screen.getByRole("button", { name: "money.importGrantCreate" }));
}

async function issueGrant(onSendToExtension: (grant: unknown) => Promise<boolean>) {
  const view = render(panel("person-1", onSendToExtension));
  const user = userEvent.setup();
  await pressIssue(user);
  return { ...view, user };
}

describe("MoneyImportGrants", () => {
  beforeEach(() => {
    mocks.grants = [];
    mocks.createGrant.mockReset();
    mocks.createGrant.mockResolvedValue({
      token: "secret-key",
      grant: { id: "grant-1", allowed_sources: ["tbank_web"] },
    });
    mocks.toast.success.mockReset();
    mocks.toast.error.mockReset();
    mocks.toast.message.mockReset();
  });

  it("hands a new key to the extension by itself and never shows it", async () => {
    const onSendToExtension = vi.fn().mockResolvedValue(true);

    await issueGrant(onSendToExtension);

    await waitFor(() => expect(onSendToExtension).toHaveBeenCalledTimes(1));
    expect(onSendToExtension).toHaveBeenCalledWith({
      token: "secret-key",
      personId: "person-1",
      allowedSources: ["tbank_web"],
      grantId: "grant-1",
    });
    expect(screen.queryByTestId("money-import-grant-token")).not.toBeInTheDocument();
    expect(mocks.toast.success).toHaveBeenCalledWith("money.importGrantSentToExtension");
  });

  it("shows the key once when no extension took it, so it can be copied elsewhere", async () => {
    const onSendToExtension = vi.fn().mockResolvedValue(false);

    await issueGrant(onSendToExtension);

    expect(await screen.findByTestId("money-import-grant-token")).toHaveTextContent("secret-key");
    expect(
      screen.getByRole("button", { name: "money.importGrantSendToExtension" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "money.importGrantCopy" })).toBeInTheDocument();
    expect(mocks.toast.message).toHaveBeenCalledWith("money.importGrantShownToCopy");
    expect(mocks.toast.error).not.toHaveBeenCalled();
  });

  it("drops an older key still on screen once a new one is delivered", async () => {
    const onSendToExtension = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const { user } = await issueGrant(onSendToExtension);
    expect(await screen.findByTestId("money-import-grant-token")).toBeInTheDocument();

    mocks.createGrant.mockResolvedValue({
      token: "second-key",
      grant: { id: "grant-2", allowed_sources: ["tbank_web"] },
    });
    await pressIssue(user);

    await waitFor(() => expect(onSendToExtension).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.queryByTestId("money-import-grant-token")).not.toBeInTheDocument(),
    );
  });

  it("keeps a key issued for one person out of another person's panel, even after the probe", async () => {
    let settle: (delivered: boolean) => void = () => {};
    const onSendToExtension = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          settle = resolve;
        }),
    );
    const { rerender } = await issueGrant(onSendToExtension);
    await waitFor(() => expect(onSendToExtension).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("money-import-grant-delivering")).toBeInTheDocument();

    rerender(panel("person-2", onSendToExtension));
    settle(false);

    await waitFor(() =>
      expect(mocks.toast.success).toHaveBeenCalledWith("money.importGrantCreatedForOtherPerson"),
    );
    expect(screen.queryByTestId("money-import-grant-token")).not.toBeInTheDocument();
    expect(screen.queryByTestId("money-import-grant-delivering")).not.toBeInTheDocument();
  });

  it("lists keys in use by last use, then expired, then revoked, saying when each was used", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 27, 12, 0));
    const grant = (id: string, overrides: Record<string, unknown>) => ({
      id,
      person_id: "person-1",
      label: id,
      allowed_sources: ["tbank_web"],
      expires_at: null,
      revoked_at: null,
      last_used_at: null,
      created_at: new Date(2026, 8, 1).toISOString(),
      ...overrides,
    });
    mocks.grants = [
      grant("revoked", { revoked_at: new Date(2026, 9, 1).toISOString() }),
      grant("never", { created_at: new Date(2026, 9, 20).toISOString() }),
      grant("expired", { expires_at: new Date(2026, 9, 2).toISOString() }),
      grant("today", { last_used_at: new Date(2026, 9, 27, 9, 5).toISOString() }),
      grant("yesterday", { last_used_at: new Date(2026, 9, 26, 22, 40).toISOString() }),
      grant("older", {
        allowed_sources: ["tbank_web", "alfa_web"],
        last_used_at: new Date(2026, 9, 12, 8, 0).toISOString(),
      }),
      grant("other-person", { person_id: "person-2" }),
      grant("unknown-bank", { allowed_sources: ["sber_web"], last_used_at: "infinity" }),
    ];

    render(panel("person-1", vi.fn()));

    const rows = within(screen.getByTestId("money-import-grant-list")).getAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      "todaymoney.importGrantUsedToday 09:05 · money.importBankTbankmoney.importGrantRevoke",
      "yesterdaymoney.importGrantUsedYesterday 22:40 · money.importBankTbankmoney.importGrantRevoke",
      "oldermoney.importGrantUsedOn 12.10.2026 · money.importBankTbank, money.importBankAlfamoney.importGrantRevoke",
      "nevermoney.importGrantNeverUsed · money.importBankTbankmoney.importGrantRevoke",
      "unknown-bankmoney.importGrantNeverUsed · sber_webmoney.importGrantRevoke",
      "expiredmoney.importGrantExpired · money.importBankTbankmoney.importGrantRevoke",
    ]);

    // Revoked keys wait folded under one line until asked for.
    expect(screen.queryByTestId("money-import-grant-revoked-list")).not.toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: /money\.importGrantRevokedToggle/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    const revoked = within(screen.getByTestId("money-import-grant-revoked-list")).getAllByRole(
      "listitem",
    );
    expect(revoked.map((row) => row.textContent)).toEqual([
      "revokedmoney.importGrantRevoked · money.importBankTbank",
    ]);
    vi.useRealTimers();
  });
});

describe("findBrowserGrantId", () => {
  const key = (id: string, createdAt: string, personId = "person-1") =>
    ({
      id,
      person_id: personId,
      label: id,
      allowed_sources: ["tbank_web"],
      expires_at: null,
      revoked_at: null,
      last_used_at: null,
      created_at: createdAt,
    }) as never;
  const keys = [
    key("old", "2026-10-01T10:00:00.000Z"),
    key("new", "2026-10-20T10:00:00.000Z"),
    key("other", "2026-10-20T10:00:05.000Z", "person-2"),
  ];

  it("takes the id the extension names, and only when that key is listed", () => {
    const held = { person_id: "person-1", received_at: "2026-01-01T00:00:00.000Z" };
    expect(findBrowserGrantId(keys, { ...held, grant_id: "old" })).toBe("old");
    expect(findBrowserGrantId(keys, { ...held, grant_id: "gone" })).toBeNull();
    expect(findBrowserGrantId(keys, null)).toBeNull();
  });

  it("recognises a key an older extension took by its person and the minute it arrived", () => {
    expect(
      findBrowserGrantId(keys, {
        grant_id: null,
        person_id: "person-1",
        received_at: "2026-10-20T10:00:03.000Z",
      }),
    ).toBe("new");
    expect(
      findBrowserGrantId(keys, {
        grant_id: null,
        person_id: "person-1",
        received_at: "2026-10-22T10:00:00.000Z",
      }),
    ).toBeNull();
    expect(
      findBrowserGrantId(keys, { grant_id: null, person_id: "person-1", received_at: "bad" }),
    ).toBeNull();

    // Another key of the same person issued in the same minute: no way to tell which, so none.
    const twins = [...keys, key("twin", "2026-10-20T10:00:04.000Z")];
    expect(
      findBrowserGrantId(twins, {
        grant_id: null,
        person_id: "person-1",
        received_at: "2026-10-20T10:00:05.000Z",
      }),
    ).toBeNull();
  });
});

describe("MoneyImportGrants and this browser", () => {
  it("puts the key this browser holds first and marks it", () => {
    mocks.grants = [
      {
        id: "used",
        person_id: "person-1",
        label: "work mac",
        allowed_sources: ["tbank_web"],
        expires_at: null,
        revoked_at: null,
        last_used_at: new Date().toISOString(),
        created_at: "2026-09-01T10:00:00.000Z",
      },
      {
        id: "mine",
        person_id: "person-1",
        label: "home pc",
        allowed_sources: ["tbank_web"],
        expires_at: null,
        revoked_at: null,
        last_used_at: null,
        created_at: "2026-10-20T10:00:00.000Z",
      },
    ];
    render(
      <MoneyImportGrants
        t={t}
        personId="person-1"
        availableSources={[{ sourceId: "tbank_web", label: "T-Bank Web" }]}
        onSendToExtension={vi.fn()}
        browserGrant={{
          grant_id: "mine",
          person_id: "person-1",
          received_at: "2026-10-20T10:00:01.000Z",
        }}
      />,
    );
    const rows = within(screen.getByTestId("money-import-grant-list")).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("home pc");
    expect(within(rows[0]).getByTestId("money-import-grant-this-browser")).toHaveTextContent(
      "money.importGrantThisBrowser",
    );
    expect(within(rows[1]).queryByTestId("money-import-grant-this-browser")).toBeNull();
  });
});
