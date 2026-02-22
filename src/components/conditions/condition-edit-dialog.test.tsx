import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Condition, ConditionRecordWithDetails } from "@/types";
import { ConditionEditDialog } from "./condition-edit-dialog";

const hookMocks = vi.hoisted(() => ({
  useIcdLookup: vi.fn(),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/hooks", () => ({
  useIcdLookup: (...args: unknown[]) => hookMocks.useIcdLookup(...args),
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({
    open,
    children,
  }: {
    open: boolean;
    onOpenChange?: (open: boolean) => void;
    children: React.ReactNode;
  }) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h3>{children}</h3>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PopoverContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/command", () => ({
  Command: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
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
  CommandList: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CommandEmpty: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CommandGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CommandItem: ({
    children,
    onSelect,
    value,
    className,
  }: {
    children: React.ReactNode;
    onSelect?: (value: string) => void;
    value?: string;
    className?: string;
  }) => (
    <button type="button" className={className} onClick={() => onSelect?.(value ?? "")}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  const SelectContext = React.createContext<{
    value?: string;
    onValueChange?: (value: string) => void;
  }>({});

  return {
    Select: ({
      value,
      onValueChange,
      children,
    }: {
      value?: string;
      onValueChange?: (value: string) => void;
      children: React.ReactNode;
    }) => (
      <SelectContext.Provider value={{ value, onValueChange }}>{children}</SelectContext.Provider>
    ),
    SelectTrigger: ({ children }: { children: React.ReactNode }) => (
      <div role="combobox" aria-controls="mock-listbox" aria-expanded={false}>
        {children}
      </div>
    ),
    SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder ?? ""}</span>,
    SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => {
      const ctx = React.useContext(SelectContext);
      return (
        <button type="button" onClick={() => ctx.onValueChange?.(value)}>
          {children}
        </button>
      );
    },
  };
});

function condition(overrides: Partial<Condition> = {}): Condition {
  return {
    id: "cond-1",
    person_id: "person-1",
    name: "Hypertension",
    icd_name_en: null,
    icd_name_ru: null,
    code: "I10",
    current_status: "active",
    onset_date: null,
    resolved_date: null,
    notes: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    deleted_at: null,
    ...overrides,
  };
}

function conditionRecord(
  overrides: Partial<ConditionRecordWithDetails> = {},
): ConditionRecordWithDetails {
  return {
    id: "record-cond-1",
    condition_id: "cond-1",
    record_id: "record-1",
    status_in_record: "active",
    source_anchor: "source text",
    confidence: 0.9,
    is_llm_extracted: true,
    is_user_verified: true,
    created_at: "2026-01-01T00:00:00.000Z",
    condition_name: "Hypertension",
    condition_icd_name_en: "Essential hypertension",
    condition_icd_name_ru: null,
    condition_code: "I10",
    condition_current_status: "active",
    condition_onset_date: null,
    condition_resolved_date: null,
    condition_notes: null,
    ...overrides,
  };
}

describe("ConditionEditDialog", () => {
  beforeEach(() => {
    hookMocks.useIcdLookup.mockImplementation((code: string | null) => {
      if (code === "D50.9") {
        return {
          data: {
            code: "D50.9",
            name_en: "Iron deficiency anemia",
            name_ru: null,
            found: true,
          },
          isLoading: false,
        };
      }
      if (code) {
        return {
          data: {
            code,
            name_en: null,
            name_ru: null,
            found: false,
          },
          isLoading: false,
        };
      }
      return { data: null, isLoading: false };
    });
  });

  it("links an existing condition and submits status/source payload", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();

    render(
      <ConditionEditDialog
        open
        onOpenChange={vi.fn()}
        conditionRecord={null}
        existingConditions={[condition()]}
        onSave={onSave}
        isNew
      />,
    );

    await user.click(screen.getByRole("button", { name: /Hypertension/ }));
    await user.click(screen.getByRole("button", { name: "conditions.status.resolved" }));
    fireEvent.change(screen.getByLabelText("conditions.sourceAnchor"), {
      target: { value: "mentioned in summary" },
    });

    await user.click(screen.getByRole("button", { name: "common.save" }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({
        condition_id: "cond-1",
        status_in_record: "resolved",
        source_anchor: "mentioned in summary",
      });
    });
  });

  it("creates a new condition with ICD lookup metadata", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();

    render(
      <ConditionEditDialog
        open
        onOpenChange={vi.fn()}
        conditionRecord={null}
        existingConditions={[condition()]}
        onSave={onSave}
        isNew
      />,
    );

    fireEvent.change(screen.getByLabelText("conditions.name *"), {
      target: { value: "Anemia" },
    });
    fireEvent.change(screen.getByLabelText("conditions.icdCode"), {
      target: { value: "d50.9" },
    });

    await user.click(screen.getByRole("button", { name: "common.save" }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({
        name: "Anemia",
        code: "D50.9",
        icd_name_en: "Iron deficiency anemia",
        icd_name_ru: null,
        status_in_record: "suspected",
        source_anchor: null,
      });
    });
  });

  it("edits an existing condition record and persists ICD/status updates", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();

    render(
      <ConditionEditDialog
        open
        onOpenChange={vi.fn()}
        conditionRecord={conditionRecord()}
        existingConditions={[condition()]}
        onSave={onSave}
        isNew={false}
      />,
    );

    await user.click(screen.getByRole("button", { name: "conditions.status.history" }));
    fireEvent.change(screen.getByLabelText("conditions.icdCode"), {
      target: { value: "I10" },
    });
    fireEvent.change(screen.getByLabelText("conditions.sourceAnchor"), {
      target: { value: "updated anchor" },
    });

    await user.click(screen.getByRole("button", { name: "common.save" }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({
        condition_id: "cond-1",
        status_in_record: "history",
        source_anchor: "updated anchor",
        code: "I10",
        icd_name_en: null,
        icd_name_ru: null,
      });
    });
  });
});
