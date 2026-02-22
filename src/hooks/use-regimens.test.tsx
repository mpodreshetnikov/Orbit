import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UpdateMedRegimenInput } from "@/types/regimen";
import { createTestQueryClient, createTestQueryWrapper } from "../../test/utils/web/render";
import { createQueryBuilder } from "../../test/utils/web/supabase-query";

const { createClientMock, notifyResolvedMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  notifyResolvedMock: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  createClient: createClientMock,
}));

vi.mock("@/lib/sw-messages", () => ({
  notifySwMedicationIntakeResolved: notifyResolvedMock,
}));

function renderHookWithQueryClient<T>(hook: () => T) {
  const queryClient = createTestQueryClient();
  const wrapper = createTestQueryWrapper(queryClient);
  return {
    queryClient,
    ...renderHook(hook, { wrapper }),
  };
}

function baseRegimenRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "reg-1",
    person_id: "person-1",
    custom_name: "Vitamin D",
    status: "active",
    intake_unit: "pill",
    dose_definition: null,
    intake_advice_type: null,
    intake_advice_text: null,
    schedule: { type: "daily" },
    duration: { type: "ongoing" },
    reminder_prefs: null,
    inventory: null,
    notes: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function baseDoseEventRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "dose-1",
    person_id: "person-1",
    regimen_id: "reg-1",
    scheduled_at: "2026-01-01T08:00:00.000Z",
    actual_at: "2026-01-01T08:00:00.000Z",
    planned_intake: { intake: { amount: 1, unit: "pill" }, active: [] },
    status: "taken",
    taken_at: "2026-01-01T08:02:00.000Z",
    note: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function baseInventoryRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "inv-1",
    regimen_id: "reg-1",
    event_id: null,
    type: "refill",
    amount: 30,
    unit: "pill",
    note: null,
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("use-regimens", () => {
  beforeEach(() => {
    createClientMock.mockReset();
    notifyResolvedMock.mockReset();
  });

  it("loads regimens for person", async () => {
    const builder = createQueryBuilder({
      data: [baseRegimenRow()],
      error: null,
    });
    createClientMock.mockReturnValue({
      from: vi.fn(() => builder),
    });

    const { useRegimens } = await import("./use-regimens");
    const { result } = renderHookWithQueryClient(() =>
      useRegimens("person-1", { status: "active" }),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(builder.eq).toHaveBeenCalledWith("person_id", "person-1");
    expect(builder.eq).toHaveBeenCalledWith("status", "active");
  });

  it("returns null when regimen is not found", async () => {
    const builder = createQueryBuilder({
      data: null,
      error: { code: "PGRST116", message: "not found" },
    });
    createClientMock.mockReturnValue({
      from: vi.fn(() => builder),
    });

    const { useRegimen } = await import("./use-regimens");
    const { result } = renderHookWithQueryClient(() => useRegimen("reg-missing"));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it("loads dose events for person with regimen details", async () => {
    const builder = createQueryBuilder({
      data: [
        {
          ...baseDoseEventRow(),
          regimen: {
            custom_name: "Vitamin D",
            intake_unit: "pill",
            intake_advice_type: null,
            intake_advice_text: null,
            schedule: { type: "daily" },
          },
        },
      ],
      error: null,
    });
    createClientMock.mockReturnValue({
      from: vi.fn(() => builder),
    });

    const { useDoseEventsForPerson } = await import("./use-regimens");
    const { result } = renderHookWithQueryClient(() =>
      useDoseEventsForPerson("person-1", "2026-01-01T00:00:00.000Z", "2026-01-02T00:00:00.000Z"),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0]).toEqual(
      expect.objectContaining({
        id: "dose-1",
        regimen: expect.objectContaining({ custom_name: "Vitamin D" }),
      }),
    );
  });

  it("filters regimen history to keep completed and past unresolved events", async () => {
    const builder = createQueryBuilder({
      data: [
        baseDoseEventRow({
          id: "past-scheduled",
          status: "scheduled",
          actual_at: "2000-01-01T00:00:00.000Z",
          taken_at: null,
        }),
        baseDoseEventRow({
          id: "future-scheduled",
          status: "scheduled",
          actual_at: "9999-01-01T00:00:00.000Z",
          taken_at: null,
        }),
        baseDoseEventRow({
          id: "taken",
          status: "taken",
          actual_at: "2025-01-01T00:00:00.000Z",
          taken_at: "2025-01-01T00:05:00.000Z",
        }),
      ],
      error: null,
    });
    createClientMock.mockReturnValue({
      from: vi.fn(() => builder),
    });

    const { useDoseEventsForRegimen } = await import("./use-regimens");
    const { result } = renderHookWithQueryClient(() => useDoseEventsForRegimen("reg-1"));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.map((d) => d.id)).toEqual(["taken", "past-scheduled"]);
  });

  it("loads inventory transactions", async () => {
    const builder = createQueryBuilder({
      data: [baseInventoryRow()],
      error: null,
    });
    createClientMock.mockReturnValue({
      from: vi.fn(() => builder),
    });

    const { useInventoryTransactions } = await import("./use-regimens");
    const { result } = renderHookWithQueryClient(() => useInventoryTransactions("reg-1"));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([
      expect.objectContaining({
        id: "inv-1",
        amount: 30,
      }),
    ]);
  });

  it("runs intake-related rpc mutations and invalidates cache", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    createClientMock.mockReturnValue({
      from: vi.fn(() => createQueryBuilder({ data: [], error: null })),
      rpc,
    });

    const {
      useMarkDoseTaken,
      useMarkDoseSkipped,
      useUndoDoseIntake,
      useUpdateDoseEventResolutionDetails,
      useSnoozeDose,
    } = await import("./use-regimens");

    const markTaken = renderHookWithQueryClient(() => useMarkDoseTaken());
    const markSkipped = renderHookWithQueryClient(() => useMarkDoseSkipped());
    const undo = renderHookWithQueryClient(() => useUndoDoseIntake());
    const updateResolution = renderHookWithQueryClient(() => useUpdateDoseEventResolutionDetails());
    const snooze = renderHookWithQueryClient(() => useSnoozeDose());

    await act(async () => {
      await markTaken.result.current.mutateAsync({
        doseEventId: "dose-1",
        note: "  with food  ",
        takenAt: "2026-01-01T08:05:00.000Z",
      });
      await markSkipped.result.current.mutateAsync({
        doseEventId: "dose-2",
        note: "   ",
      });
      await undo.result.current.mutateAsync({ doseEventId: "dose-3" });
      await updateResolution.result.current.mutateAsync({
        doseEventId: "dose-4",
        takenAt: "",
        amountTaken: 2,
        note: " adjusted ",
      });
      await snooze.result.current.mutateAsync({
        doseEventId: "dose-5",
        authUserId: "auth-1",
      });
    });

    expect(rpc).toHaveBeenCalledWith("mark_dose_taken", {
      p_dose_event_id: "dose-1",
      p_note: "with food",
      p_taken_at: "2026-01-01T08:05:00.000Z",
    });
    expect(rpc).toHaveBeenCalledWith("mark_dose_skipped", {
      p_dose_event_id: "dose-2",
    });
    expect(rpc).toHaveBeenCalledWith("undo_dose_intake", {
      p_dose_event_id: "dose-3",
    });
    expect(rpc).toHaveBeenCalledWith("update_dose_event_resolution_details", {
      p_dose_event_id: "dose-4",
      p_taken_at: undefined,
      p_amount_taken: 2,
      p_note: "adjusted",
    });
    expect(rpc).toHaveBeenCalledWith("snooze_dose", {
      p_dose_event_id: "dose-5",
      p_auth_user_id: "auth-1",
      p_minutes_from_now: 15,
    });
    expect(notifyResolvedMock).toHaveBeenCalledWith(["dose-1"]);
    expect(notifyResolvedMock).toHaveBeenCalledWith(["dose-2"]);
  });

  it("creates and updates regimen", async () => {
    const regimenBuilder = createQueryBuilder({
      data: baseRegimenRow(),
      error: null,
    });
    createClientMock.mockReturnValue({
      from: vi.fn(() => regimenBuilder),
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    });

    const { useCreateRegimen, useUpdateRegimen } = await import("./use-regimens");
    const createHook = renderHookWithQueryClient(() => useCreateRegimen());
    const updateHook = renderHookWithQueryClient(() => useUpdateRegimen());

    await act(async () => {
      await createHook.result.current.mutateAsync({
        person_id: "person-1",
        custom_name: "Vitamin D",
        intake_unit: "pill",
        schedule: { type: "daily" },
        duration: { type: "ongoing" },
      } as unknown as import("@/types").CreateMedRegimenInput);

      await updateHook.result.current.mutateAsync({
        id: "reg-1",
        updates: { custom_name: "Vitamin D3", notes: "night" },
      } as { id: string; updates: UpdateMedRegimenInput });
    });

    expect(regimenBuilder.insert).toHaveBeenCalled();
    expect(regimenBuilder.update).toHaveBeenCalledWith({
      custom_name: "Vitamin D3",
      notes: "night",
      intake_advice_type: undefined,
      dose_definition: undefined,
      schedule: undefined,
      duration: undefined,
      reminder_prefs: undefined,
      inventory: undefined,
    });
  });

  it("adds one-time dose and updates inventory", async () => {
    const doseBuilder = createQueryBuilder({
      data: { id: "dose-created" },
      error: null,
    });
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    createClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "med_dose_events") return doseBuilder;
        return createQueryBuilder({ data: null, error: null });
      }),
      rpc,
    });

    const { useAddOneTimeDoseToRegimen, useUpdateRegimenInventory } =
      await import("./use-regimens");
    const addOneTime = renderHookWithQueryClient(() => useAddOneTimeDoseToRegimen());
    const updateInventory = renderHookWithQueryClient(() => useUpdateRegimenInventory());

    await act(async () => {
      await addOneTime.result.current.mutateAsync({
        person_id: "person-1",
        regimen_id: "reg-1",
        scheduled_at: "2026-01-01T08:00:00.000Z",
        amount: 1,
        unit: "pill",
        notes: " after breakfast ",
      });
      await updateInventory.result.current.mutateAsync({
        regimenId: "reg-1",
        type: "refill",
        amount: 20,
        note: "restock",
      });
    });

    expect(doseBuilder.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        regimen_id: "reg-1",
        status: "scheduled",
      }),
    );
    expect(rpc).toHaveBeenCalledWith("mark_dose_taken", {
      p_dose_event_id: "dose-created",
      p_note: "after breakfast",
    });
    expect(rpc).toHaveBeenCalledWith("update_regimen_inventory", {
      p_regimen_id: "reg-1",
      p_type: "refill",
      p_amount: 20,
      p_note: "restock",
    });
  });

  it("deletes and archives regimen", async () => {
    const eventBuilder = createQueryBuilder({ data: null, error: null });
    const regimenBuilder = createQueryBuilder({ data: null, error: null });
    createClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "med_dose_events") return eventBuilder;
        if (table === "med_regimens") return regimenBuilder;
        return createQueryBuilder({ data: null, error: null });
      }),
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    });

    const { useDeleteRegimen, useArchiveRegimen } = await import("./use-regimens");
    const deleteHook = renderHookWithQueryClient(() => useDeleteRegimen());
    const archiveHook = renderHookWithQueryClient(() => useArchiveRegimen());

    await act(async () => {
      await deleteHook.result.current.mutateAsync({
        id: "reg-1",
        personId: "person-1",
      });
      await archiveHook.result.current.mutateAsync({
        id: "reg-1",
        personId: "person-1",
      });
    });

    expect(regimenBuilder.update).toHaveBeenCalledWith({ deleted_at: expect.any(String) });
    expect(regimenBuilder.update).toHaveBeenCalledWith({ status: "archived" });
    expect(eventBuilder.delete).toHaveBeenCalled();
    expect(eventBuilder.in).toHaveBeenCalledWith("status", ["scheduled", "sent", "snoozed"]);
  });

  it("covers helper normalizers and row mappers", async () => {
    const {
      normalizeIntakeAdviceType,
      rowToDoseEvent,
      rowToInventoryTransaction,
      rowToRegimen,
      toJsonOrNull,
      toRpcOptionalString,
    } = await import("./use-regimens");

    expect(toJsonOrNull(null)).toBeNull();
    expect(toJsonOrNull({ a: 1 } as unknown)).toEqual({ a: 1 });
    expect(toRpcOptionalString(undefined)).toBeUndefined();
    expect(toRpcOptionalString("   ")).toBeUndefined();
    expect(toRpcOptionalString(" note ")).toBe("note");

    expect(normalizeIntakeAdviceType(undefined)).toBeUndefined();
    expect(normalizeIntakeAdviceType(null)).toBeNull();
    expect(normalizeIntakeAdviceType("before_meal")).toBe("before_meal");
    expect(normalizeIntakeAdviceType("unsupported")).toBeNull();

    expect(rowToRegimen(baseRegimenRow())).toEqual(expect.objectContaining({ id: "reg-1" }));
    expect(
      rowToDoseEvent(
        baseDoseEventRow({
          planned_intake: null,
        }) as Record<string, unknown>,
      ),
    ).toEqual(
      expect.objectContaining({
        planned_intake: {
          intake: { amount: 1, unit: "pill" },
          active: [],
        },
      }),
    );
    expect(
      rowToInventoryTransaction(
        baseInventoryRow({
          amount: "42",
        }) as Record<string, unknown>,
      ),
    ).toEqual(
      expect.objectContaining({
        amount: 42,
      }),
    );
  });

  it("returns regimen query errors and supports disabled hooks", async () => {
    const fromMock = vi.fn(() =>
      createQueryBuilder({
        data: null,
        error: { code: "boom", message: "regimen query failed" },
      }),
    );
    createClientMock.mockReturnValue({ from: fromMock });

    const { useRegimen, useRegimens } = await import("./use-regimens");
    const regimensError = renderHookWithQueryClient(() =>
      useRegimens("person-1", { status: "active" }),
    );
    const regimenError = renderHookWithQueryClient(() => useRegimen("reg-1"));
    const disabledRegimens = renderHookWithQueryClient(() => useRegimens(null));
    const disabledRegimen = renderHookWithQueryClient(() => useRegimen(null));

    await waitFor(() => expect(regimensError.result.current.isError).toBe(true));
    await waitFor(() => expect(regimenError.result.current.isError).toBe(true));
    expect((regimensError.result.current.error as Error).message).toBe("regimen query failed");
    expect((regimenError.result.current.error as Error).message).toBe("regimen query failed");
    expect(disabledRegimens.result.current.fetchStatus).toBe("idle");
    expect(disabledRegimen.result.current.fetchStatus).toBe("idle");
  });

  it("propagates delete/archive/inventory mutation errors", async () => {
    const doseEventsErrorBuilder = createQueryBuilder({
      data: null,
      error: { message: "dose events update failed" },
    });
    const regimensErrorBuilder = createQueryBuilder({
      data: null,
      error: { message: "regimen update failed" },
    });
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "inventory rpc failed" },
    });

    createClientMock.mockImplementation(() => ({
      from: vi.fn((table: string) => {
        if (table === "med_dose_events") return doseEventsErrorBuilder;
        if (table === "med_regimens") return regimensErrorBuilder;
        return createQueryBuilder({ data: null, error: null });
      }),
      rpc,
    }));

    const { useArchiveRegimen, useDeleteRegimen, useUpdateRegimenInventory } =
      await import("./use-regimens");
    const deleteHook = renderHookWithQueryClient(() => useDeleteRegimen());
    const archiveHook = renderHookWithQueryClient(() => useArchiveRegimen());
    const inventoryHook = renderHookWithQueryClient(() => useUpdateRegimenInventory());

    await expect(
      deleteHook.result.current.mutateAsync({
        id: "reg-1",
        personId: "person-1",
      }),
    ).rejects.toThrow("dose events update failed");
    await expect(
      archiveHook.result.current.mutateAsync({
        id: "reg-1",
        personId: "person-1",
      }),
    ).rejects.toThrow("regimen update failed");
    await expect(
      inventoryHook.result.current.mutateAsync({
        regimenId: "reg-1",
        type: "refill",
        amount: 5,
      }),
    ).rejects.toThrow("inventory rpc failed");
  });
});
