import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConditionAddHistoryDialog } from "./condition-add-history-dialog";

const hookMocks = vi.hoisted(() => ({
  useLinkConditionToRecord: vi.fn(),
  useCreateMedicalRecord: vi.fn(),
}));

const linkMutateAsync = vi.fn();
const createRecordMutateAsync = vi.fn();

vi.mock("next-intl", () => ({
  useTranslations:
    () =>
    (key: string): string =>
      key,
}));

vi.mock("@/hooks", () => ({
  useLinkConditionToRecord: (...args: unknown[]) => hookMocks.useLinkConditionToRecord(...args),
  useCreateMedicalRecord: (...args: unknown[]) => hookMocks.useCreateMedicalRecord(...args),
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({
    open,
    children,
  }: {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    children: React.ReactNode;
  }) => <div>{open ? children : null}</div>,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h3>{children}</h3>,
}));

vi.mock("@/components/ui/select", async () => {
  const ReactModule = await import("react");
  const SelectContext = ReactModule.createContext<(value: string) => void>(() => {});

  return {
    Select: ({
      onValueChange,
      children,
    }: {
      value?: string;
      onValueChange?: (value: string) => void;
      children: React.ReactNode;
    }) => (
      <SelectContext.Provider value={(value) => onValueChange?.(value)}>
        <div>{children}</div>
      </SelectContext.Provider>
    ),
    SelectTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    SelectValue: () => <span>value</span>,
    SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => {
      const onSelect = ReactModule.useContext(SelectContext);
      return (
        <button type="button" onClick={() => onSelect(value)}>
          {children}
        </button>
      );
    },
  };
});

vi.mock("@/components/ui/popover", () => ({
  Popover: ({
    open,
    children,
  }: {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    children: React.ReactNode;
  }) => <div>{open ? children : null}</div>,
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PopoverContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/command", () => ({
  Command: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CommandEmpty: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CommandGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CommandInput: ({
    value,
    onValueChange,
    placeholder,
  }: {
    value?: string;
    onValueChange?: (value: string) => void;
    placeholder?: string;
  }) => (
    <input
      aria-label={placeholder ?? "command-input"}
      value={value ?? ""}
      onChange={(event) => onValueChange?.(event.target.value)}
    />
  ),
  CommandItem: ({
    onSelect,
    children,
  }: {
    value: string;
    onSelect?: () => void;
    children: React.ReactNode;
  }) => (
    <button type="button" onClick={onSelect}>
      {children}
    </button>
  ),
  CommandList: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

describe("ConditionAddHistoryDialog", () => {
  beforeEach(() => {
    linkMutateAsync.mockReset();
    createRecordMutateAsync.mockReset();
    linkMutateAsync.mockResolvedValue(undefined);
    createRecordMutateAsync.mockResolvedValue({ id: "new-record" });

    hookMocks.useLinkConditionToRecord.mockReturnValue({
      mutateAsync: linkMutateAsync,
      isPending: false,
    });
    hookMocks.useCreateMedicalRecord.mockReturnValue({
      mutateAsync: createRecordMutateAsync,
      isPending: false,
    });
  });

  it("creates manual record and links condition when no record is selected", async () => {
    const onOpenChange = vi.fn();
    const onSaved = vi.fn();

    render(
      <ConditionAddHistoryDialog
        open
        onOpenChange={onOpenChange}
        conditionId="cond-1"
        conditionName="Asthma"
        personId="person-1"
        records={[]}
        onSaved={onSaved}
      />,
    );

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("conditions.historyNote"), "manual note");
    await user.click(screen.getByRole("button", { name: "common.save" }));

    await waitFor(() => {
      expect(createRecordMutateAsync).toHaveBeenCalledWith({
        person_id: "person-1",
        title: "conditions.manualEntryTitle (Asthma)",
        record_date: expect.any(String),
        record_type: "other",
        status: "active",
        notes: "manual note",
      });
      expect(linkMutateAsync).toHaveBeenCalledWith({
        condition_id: "cond-1",
        record_id: "new-record",
        status_in_record: "active",
        source_anchor: "manual note",
      });
      expect(onSaved).toHaveBeenCalled();
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it("links to selected existing record without creating manual record", async () => {
    render(
      <ConditionAddHistoryDialog
        open
        onOpenChange={vi.fn()}
        conditionId="cond-1"
        conditionName="Asthma"
        personId="person-1"
        records={
          [
            { id: "rec-1", title: "Visit record", record_date: "2026-02-01" },
          ] as unknown as import("@/types").MedicalRecordListItem[]
        }
        preselectedRecordId="rec-1"
      />,
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "conditions.status.suspected" }));
    await user.click(screen.getByRole("button", { name: "common.save" }));

    await waitFor(() => {
      expect(createRecordMutateAsync).not.toHaveBeenCalled();
      expect(linkMutateAsync).toHaveBeenCalledWith({
        condition_id: "cond-1",
        record_id: "rec-1",
        status_in_record: "suspected",
        source_anchor: undefined,
      });
    });
  });
});
