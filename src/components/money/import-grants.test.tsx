import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MoneyImportGrants } from "./import-grants";

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
