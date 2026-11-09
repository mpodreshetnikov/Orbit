import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SelfTransferAliases } from "./self-transfer-aliases";

const hookMocks = vi.hoisted(() => ({
  useMoneyTransferSelfAliases: vi.fn(),
  createAlias: vi.fn(),
  deleteAlias: vi.fn(),
}));

const toastMock = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("@/hooks", () => ({
  useMoneyTransferSelfAliases: (...args: unknown[]) =>
    hookMocks.useMoneyTransferSelfAliases(...args),
  useCreateMoneyTransferSelfAlias: () => ({ mutateAsync: hookMocks.createAlias, isPending: false }),
  useDeleteMoneyTransferSelfAlias: () => ({ mutateAsync: hookMocks.deleteAlias, isPending: false }),
}));

describe("SelfTransferAliases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hookMocks.useMoneyTransferSelfAliases.mockReturnValue({
      data: [{ id: "alias-1", alias: "Макс П", normalized_alias: "макс п" }],
    });
    hookMocks.createAlias.mockResolvedValue({});
    hookMocks.deleteAlias.mockResolvedValue(undefined);
  });

  it("lists the person's aliases", () => {
    render(<SelfTransferAliases personId="person-1" />);
    expect(hookMocks.useMoneyTransferSelfAliases).toHaveBeenCalledWith("person-1");
    expect(screen.getByText("Макс П")).toBeInTheDocument();
  });

  it("adds an alias and clears the field", async () => {
    render(<SelfTransferAliases personId="person-1" />);
    const field = screen.getByLabelText("money.reportSelfAliases");
    fireEvent.change(field, { target: { value: "  Подрешетников М  " } });
    fireEvent.click(screen.getByRole("button", { name: /common.add/ }));
    await waitFor(() =>
      expect(hookMocks.createAlias).toHaveBeenCalledWith({
        personId: "person-1",
        alias: "Подрешетников М",
      }),
    );
    await waitFor(() => expect(field).toHaveValue(""));
    expect(toastMock.success).toHaveBeenCalledWith("money.reportAliasSaved");
  });

  it("refuses an empty alias and reports a failed save", async () => {
    render(<SelfTransferAliases personId="person-1" />);
    fireEvent.click(screen.getByRole("button", { name: /common.add/ }));
    expect(toastMock.error).toHaveBeenCalledWith("money.reportAliasValidation");
    expect(hookMocks.createAlias).not.toHaveBeenCalled();

    hookMocks.createAlias.mockRejectedValue(new Error("duplicate"));
    fireEvent.change(screen.getByLabelText("money.reportSelfAliases"), { target: { value: "X" } });
    fireEvent.click(screen.getByRole("button", { name: /common.add/ }));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("duplicate"));
  });

  it("deletes an alias, and says so when that fails", async () => {
    render(<SelfTransferAliases personId="person-1" />);
    fireEvent.click(screen.getByRole("button", { name: "common.delete Макс П" }));
    await waitFor(() => expect(hookMocks.deleteAlias).toHaveBeenCalledWith("alias-1"));
    expect(toastMock.success).toHaveBeenCalledWith("money.reportAliasDeleted");

    hookMocks.deleteAlias.mockRejectedValue("nope");
    fireEvent.click(screen.getByRole("button", { name: "common.delete Макс П" }));
    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith("money.reportAliasDeleteFailed"),
    );
  });

  it("says when there are none", () => {
    hookMocks.useMoneyTransferSelfAliases.mockReturnValue({ data: [] });
    render(<SelfTransferAliases personId="person-1" />);
    expect(screen.getByText("money.reportAliasesEmpty")).toBeInTheDocument();
  });
});
