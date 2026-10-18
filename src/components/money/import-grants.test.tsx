import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MoneyImportGrants } from "./import-grants";

const mocks = vi.hoisted(() => ({
  createGrant: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() },
}));

vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("@/hooks/use-money-import-grants", () => ({
  useMoneyImportGrants: () => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() }),
  useCreateMoneyImportGrant: () => ({ mutateAsync: mocks.createGrant, isPending: false }),
  useRevokeMoneyImportGrant: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

const t = (key: string) => key;

async function issueGrant(onSendToExtension: (grant: unknown) => Promise<boolean>) {
  render(
    <MoneyImportGrants
      t={t}
      personId="person-1"
      availableSources={[{ sourceId: "tbank_web", label: "T-Bank" }]}
      onSendToExtension={onSendToExtension}
    />,
  );
  const user = userEvent.setup();
  await user.type(screen.getByPlaceholderText("money.importGrantLabelPlaceholder"), "home laptop");
  await user.click(screen.getByRole("button", { name: "money.importGrantCreate" }));
}

describe("MoneyImportGrants", () => {
  beforeEach(() => {
    mocks.createGrant.mockReset();
    mocks.createGrant.mockResolvedValue({ token: "secret-key", id: "grant-1" });
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
});
