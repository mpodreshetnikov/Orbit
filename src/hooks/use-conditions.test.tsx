import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CreateConditionInput,
  CreateConditionRecordInput,
  UpdateConditionInput,
} from "@/types";
import { createTestQueryClient, createTestQueryWrapper } from "../../test/utils/web/render";
import { createQueryBuilder } from "../../test/utils/web/supabase-query";
import { AUTHORITATIVE_STATUS_FILTER } from "@/lib/conditions/unverified-closure";

const { createClientMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  createClient: createClientMock,
}));

function renderHookWithQueryClient<T>(hook: () => T) {
  const queryClient = createTestQueryClient();
  const wrapper = createTestQueryWrapper(queryClient);
  return {
    queryClient,
    ...renderHook(hook, { wrapper }),
  };
}

function conditionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "cond-1",
    person_id: "person-1",
    name: "Asthma",
    current_status: "active",
    code: null,
    icd_name_en: null,
    icd_name_ru: null,
    deleted_at: null,
    ...overrides,
  };
}

describe("use-conditions", () => {
  beforeEach(() => {
    createClientMock.mockReset();
  });

  it("loads person conditions and with-history list", async () => {
    const conditionsBuilder = createQueryBuilder({
      data: [conditionRow()],
      error: null,
    });
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          ...conditionRow(),
          mention_count: 2,
        },
      ],
      error: null,
    });
    createClientMock.mockReturnValue({
      from: vi.fn(() => conditionsBuilder),
      rpc,
    });

    const { usePersonConditions, usePersonConditionsWithHistory } =
      await import("./use-conditions");
    const listHook = renderHookWithQueryClient(() => usePersonConditions("person-1"));
    const historyHook = renderHookWithQueryClient(() => usePersonConditionsWithHistory("person-1"));

    await waitFor(() => expect(listHook.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(historyHook.result.current.isSuccess).toBe(true));

    expect(listHook.result.current.data?.[0]).toEqual(expect.objectContaining({ id: "cond-1" }));
    expect(rpc).toHaveBeenCalledWith("get_person_conditions_with_history", {
      p_person_id: "person-1",
    });
  });

  it("loads condition detail with timeline stats", async () => {
    const conditionsBuilder = createQueryBuilder({
      data: conditionRow(),
      error: null,
    });
    const conditionRecordsBuilder = createQueryBuilder({
      data: [
        {
          id: "cr-1",
          record_id: "r-1",
          status_in_record: "active",
          source_anchor: null,
          confidence: null,
          is_llm_extracted: false,
          is_user_verified: true,
          created_at: "2026-01-01T00:00:00.000Z",
          medical_records: { title: "Visit", record_date: "2026-01-01", record_type: "visit" },
        },
        {
          id: "cr-2",
          record_id: "r-2",
          status_in_record: "resolved",
          source_anchor: null,
          confidence: null,
          is_llm_extracted: false,
          is_user_verified: true,
          created_at: "2026-02-01T00:00:00.000Z",
          medical_records: { title: "Lab", record_date: "2026-02-01", record_type: "lab" },
        },
      ],
      error: null,
    });
    createClientMock.mockReturnValue({
      from: vi.fn((table: string) =>
        table === "conditions" ? conditionsBuilder : conditionRecordsBuilder,
      ),
    });

    const { useConditionDetail } = await import("./use-conditions");
    const { result } = renderHookWithQueryClient(() => useConditionDetail("cond-1"));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(
      expect.objectContaining({
        mention_count: 2,
        first_mentioned_date: "2026-01-01",
        last_mentioned_date: "2026-02-01",
      }),
    );
  });

  it("builds condition-record history map by condition id", async () => {
    const builder = createQueryBuilder({
      data: [
        { condition_id: "cond-1", record_id: "r-1" },
        { condition_id: "cond-1", record_id: "r-2" },
        { condition_id: "cond-2", record_id: "r-3" },
      ],
      error: null,
    });
    createClientMock.mockReturnValue({
      from: vi.fn(() => builder),
    });

    const { fetchPersonConditionRecordHistory } = await import("./use-conditions");
    const map = await fetchPersonConditionRecordHistory("person-1");
    expect(map).toEqual({
      "cond-1": ["r-1", "r-2"],
      "cond-2": ["r-3"],
    });
  });

  it("creates, updates, and deletes condition", async () => {
    const builder = createQueryBuilder({
      data: conditionRow(),
      error: null,
    });
    createClientMock.mockReturnValue({
      from: vi.fn(() => builder),
    });

    const { useCreateCondition, useUpdateCondition, useDeleteCondition } =
      await import("./use-conditions");
    const createHook = renderHookWithQueryClient(() => useCreateCondition());
    const updateHook = renderHookWithQueryClient(() => useUpdateCondition());
    const deleteHook = renderHookWithQueryClient(() => useDeleteCondition());

    await act(async () => {
      await createHook.result.current.mutateAsync({
        person_id: "person-1",
        name: "Asthma",
        current_status: "active",
      } as CreateConditionInput);
      await updateHook.result.current.mutateAsync({
        id: "cond-1",
        updates: { name: "Asthma Updated" },
      } as { id: string; updates: UpdateConditionInput });
      await deleteHook.result.current.mutateAsync({
        id: "cond-1",
        personId: "person-1",
      });
    });

    expect(builder.insert).toHaveBeenCalled();
    expect(builder.update).toHaveBeenCalledWith({ name: "Asthma Updated" });
    expect(builder.update).toHaveBeenCalledWith({ deleted_at: expect.any(String) });
  });

  it("updates condition record with status recompute and icd update", async () => {
    const conditionRecordsBuilder = createQueryBuilder({
      data: {
        id: "cr-1",
        record_id: "record-1",
        condition_id: "cond-1",
      },
      error: null,
    });
    vi.mocked(conditionRecordsBuilder.maybeSingle).mockResolvedValue({
      data: { status_in_record: "resolved" },
      error: null,
    });
    const conditionsBuilder = createQueryBuilder({
      data: conditionRow(),
      error: null,
    });

    createClientMock.mockReturnValue({
      from: vi.fn((table: string) =>
        table === "condition_records" ? conditionRecordsBuilder : conditionsBuilder,
      ),
    });

    const { useUpdateConditionRecord } = await import("./use-conditions");
    const { result } = renderHookWithQueryClient(() => useUpdateConditionRecord());

    await act(async () => {
      await result.current.mutateAsync({
        id: "cr-1",
        updates: { status_in_record: "resolved" },
        conditionId: "cond-1",
        code: "J45",
        icd_name_en: "Asthma",
      });
    });

    expect(conditionRecordsBuilder.update).toHaveBeenCalledWith({ status_in_record: "resolved" });
    expect(conditionsBuilder.update).toHaveBeenCalledWith({ current_status: "resolved" });
    expect(conditionsBuilder.update).toHaveBeenCalledWith({
      code: "J45",
      icd_name_en: "Asthma",
    });
  });

  it("recomputes on verification alone, so an approved closure reaches the condition", async () => {
    // Activating a record verifies every mention and passes nothing else -- no status, no
    // condition id. The closure is suppressed until exactly this moment, so if verification did
    // not trigger the recompute the confirmed resolution would never reach the chart.
    const conditionRecordsBuilder = createQueryBuilder({
      data: {
        id: "cr-1",
        record_id: "record-1",
        condition_id: "cond-1",
      },
      error: null,
    });
    vi.mocked(conditionRecordsBuilder.maybeSingle).mockResolvedValue({
      data: { status_in_record: "resolved" },
      error: null,
    });
    const conditionsBuilder = createQueryBuilder({ data: conditionRow(), error: null });

    createClientMock.mockReturnValue({
      from: vi.fn((table: string) =>
        table === "condition_records" ? conditionRecordsBuilder : conditionsBuilder,
      ),
    });

    const { useUpdateConditionRecord } = await import("./use-conditions");
    const { result } = renderHookWithQueryClient(() => useUpdateConditionRecord());

    await act(async () => {
      await result.current.mutateAsync({
        id: "cr-1",
        updates: { is_user_verified: true },
      });
    });

    expect(conditionsBuilder.update).toHaveBeenCalledWith({ current_status: "resolved" });
    // The ruling travels with the verification. A row that is verified while still reading
    // `pending` would count as "nobody looked" in the counts that decide whether an analyte may
    // one day close a condition unattended.
    expect(conditionRecordsBuilder.update).toHaveBeenCalledWith({
      is_user_verified: true,
      review_decision: "confirmed",
    });
  });

  it("keeps a decision the caller stated rather than overwriting it", async () => {
    const conditionRecordsBuilder = createQueryBuilder({
      data: { id: "cr-1", record_id: "record-1", condition_id: "cond-1" },
      error: null,
    });
    vi.mocked(conditionRecordsBuilder.maybeSingle).mockResolvedValue({
      data: { status_in_record: "active" },
      error: null,
    });
    const conditionsBuilder = createQueryBuilder({ data: conditionRow(), error: null });

    createClientMock.mockReturnValue({
      from: vi.fn((table: string) =>
        table === "condition_records" ? conditionRecordsBuilder : conditionsBuilder,
      ),
    });

    const { useUpdateConditionRecord } = await import("./use-conditions");
    const { result } = renderHookWithQueryClient(() => useUpdateConditionRecord());

    await act(async () => {
      await result.current.mutateAsync({
        id: "cr-1",
        updates: { is_user_verified: true, review_decision: "dismissed" },
      });
    });

    expect(conditionRecordsBuilder.update).toHaveBeenCalledWith({
      is_user_verified: true,
      review_decision: "dismissed",
    });
  });

  it("excludes unconfirmed machine closures from the recompute", async () => {
    const conditionRecordsBuilder = createQueryBuilder({
      data: { id: "cr-1", record_id: "record-1", condition_id: "cond-1" },
      error: null,
    });
    vi.mocked(conditionRecordsBuilder.maybeSingle).mockResolvedValue({
      data: { status_in_record: "active" },
      error: null,
    });
    const conditionsBuilder = createQueryBuilder({ data: conditionRow(), error: null });

    createClientMock.mockReturnValue({
      from: vi.fn((table: string) =>
        table === "condition_records" ? conditionRecordsBuilder : conditionsBuilder,
      ),
    });

    const { useUpdateConditionRecord } = await import("./use-conditions");
    const { result } = renderHookWithQueryClient(() => useUpdateConditionRecord());

    await act(async () => {
      await result.current.mutateAsync({
        id: "cr-1",
        updates: { status_in_record: "active" },
        conditionId: "cond-1",
      });
    });

    // The filter has to reach the query, and it has to reach it before the limit -- a recompute
    // that filtered afterwards would let a suppressed closure shadow the row beneath it.
    expect(conditionRecordsBuilder.or).toHaveBeenCalledWith(AUTHORITATIVE_STATUS_FILTER);
    expect(conditionRecordsBuilder.or.mock.invocationCallOrder[0]).toBeLessThan(
      conditionRecordsBuilder.limit.mock.invocationCallOrder[0],
    );
  });

  it("deletes condition record and recomputes status", async () => {
    const conditionRecordsBuilder = createQueryBuilder({
      data: { condition_id: "cond-1" },
      error: null,
    });
    vi.mocked(conditionRecordsBuilder.maybeSingle).mockResolvedValue({
      data: { status_in_record: "active" },
      error: null,
    });
    const conditionsBuilder = createQueryBuilder({
      data: conditionRow(),
      error: null,
    });
    createClientMock.mockReturnValue({
      from: vi.fn((table: string) =>
        table === "condition_records" ? conditionRecordsBuilder : conditionsBuilder,
      ),
    });

    const { useDeleteConditionRecord } = await import("./use-conditions");
    const { result } = renderHookWithQueryClient(() => useDeleteConditionRecord());

    await act(async () => {
      await result.current.mutateAsync({
        id: "cr-1",
        recordId: "record-1",
      });
    });

    expect(conditionRecordsBuilder.delete).toHaveBeenCalled();
    expect(conditionsBuilder.update).toHaveBeenCalledWith({ current_status: "active" });
  });

  it("creates condition+record and links existing condition", async () => {
    const conditionsBuilder = createQueryBuilder({
      data: conditionRow(),
      error: null,
    });
    const conditionRecordsBuilder = createQueryBuilder({
      data: {
        id: "cr-1",
        record_id: "record-1",
        condition_id: "cond-1",
      },
      error: null,
    });
    vi.mocked(conditionRecordsBuilder.single)
      .mockResolvedValueOnce({
        data: {
          id: "cr-link",
          record_id: "record-1",
          condition_id: "cond-1",
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          medical_records: { record_date: "2026-01-01" },
        },
        error: null,
      });

    const medicalRecordsBuilder = createQueryBuilder({
      data: { record_date: "2026-01-02" },
      error: null,
    });

    createClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "conditions") return conditionsBuilder;
        if (table === "condition_records") return conditionRecordsBuilder;
        if (table === "medical_records") return medicalRecordsBuilder;
        return createQueryBuilder({ data: null, error: null });
      }),
    });

    const { useCreateConditionWithRecord, useLinkConditionToRecord } =
      await import("./use-conditions");
    const createWithRecord = renderHookWithQueryClient(() => useCreateConditionWithRecord());
    const linkHook = renderHookWithQueryClient(() => useLinkConditionToRecord());

    await act(async () => {
      await createWithRecord.result.current.mutateAsync({
        person_id: "person-1",
        record_id: "record-1",
        name: "Asthma",
        status: "active",
      });
      await linkHook.result.current.mutateAsync({
        condition_id: "cond-1",
        record_id: "record-1",
        status_in_record: "resolved",
        code: "J45",
        icd_name_en: "Asthma",
      });
    });

    expect(conditionsBuilder.insert).toHaveBeenCalled();
    expect(conditionRecordsBuilder.insert).toHaveBeenCalled();
    expect(conditionsBuilder.update).toHaveBeenCalledWith({
      current_status: "resolved",
      code: "J45",
      icd_name_en: "Asthma",
    });
  });

  it("loads record conditions via rpc and returns rpc errors", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: [{ id: "cr-1", record_id: "record-1", condition_id: "cond-1" }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: null,
        error: { message: "rpc failed" },
      });
    createClientMock.mockReturnValue({ rpc });

    const { useRecordConditions } = await import("./use-conditions");
    const successHook = renderHookWithQueryClient(() => useRecordConditions("record-1"));
    const errorHook = renderHookWithQueryClient(() => useRecordConditions("record-2"));

    await waitFor(() => expect(successHook.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(errorHook.result.current.isError).toBe(true));
    expect(successHook.result.current.data).toEqual([
      expect.objectContaining({
        id: "cr-1",
      }),
    ]);
    expect((errorHook.result.current.error as Error).message).toBe("rpc failed");
  });

  it("creates condition records and propagates insert errors", async () => {
    const successBuilder = createQueryBuilder({
      data: {
        id: "cr-created",
        record_id: "record-1",
        condition_id: "cond-1",
      },
      error: null,
    });
    const errorBuilder = createQueryBuilder({
      data: null,
      error: { message: "insert condition record failed" },
    });
    createClientMock.mockImplementation(() => ({
      from: vi.fn(() => (createClientMock.mock.calls.length === 1 ? successBuilder : errorBuilder)),
    }));

    const { useCreateConditionRecord } = await import("./use-conditions");
    const successHook = renderHookWithQueryClient(() => useCreateConditionRecord());
    const errorHook = renderHookWithQueryClient(() => useCreateConditionRecord());

    await act(async () => {
      await successHook.result.current.mutateAsync({
        record_id: "record-1",
        condition_id: "cond-1",
        status_in_record: "active",
      } as CreateConditionRecordInput);
    });

    await expect(
      errorHook.result.current.mutateAsync({
        record_id: "record-2",
        condition_id: "cond-1",
        status_in_record: "active",
      } as CreateConditionRecordInput),
    ).rejects.toThrow("insert condition record failed");
    expect(successBuilder.insert).toHaveBeenCalled();
  });

  it("updates condition ICD only when status_in_record is not changing", async () => {
    const conditionRecordsBuilder = createQueryBuilder({
      data: {
        id: "cr-1",
        record_id: "record-1",
        condition_id: "cond-1",
      },
      error: null,
    });
    const conditionsBuilder = createQueryBuilder({
      data: conditionRow(),
      error: null,
    });
    createClientMock.mockReturnValue({
      from: vi.fn((table: string) =>
        table === "condition_records" ? conditionRecordsBuilder : conditionsBuilder,
      ),
    });

    const { useUpdateConditionRecord } = await import("./use-conditions");
    const { result } = renderHookWithQueryClient(() => useUpdateConditionRecord());

    await act(async () => {
      await result.current.mutateAsync({
        id: "cr-1",
        updates: { source_anchor: "manual" },
        conditionId: "cond-1",
        code: "J44",
        icd_name_en: null,
      });
    });

    expect(conditionsBuilder.update).toHaveBeenCalledWith({
      code: "J44",
      icd_name_en: null,
    });
  });

  it("handles delete condition-record fallback path when original row is missing", async () => {
    const selectSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const selectEq = vi.fn(() => ({ single: selectSingle }));
    const select = vi.fn(() => ({ eq: selectEq }));
    const deleteEq = vi.fn().mockResolvedValue({ data: null, error: null });
    const deleteFn = vi.fn(() => ({ eq: deleteEq }));
    const fromMock = vi
      .fn()
      .mockImplementation(() =>
        fromMock.mock.calls.length === 1
          ? { select, delete: vi.fn(() => ({ eq: vi.fn() })) }
          : { delete: deleteFn },
      );

    createClientMock.mockReturnValue({ from: fromMock });

    const { useDeleteConditionRecord } = await import("./use-conditions");
    const { result } = renderHookWithQueryClient(() => useDeleteConditionRecord());

    await act(async () => {
      await result.current.mutateAsync({
        id: "cr-1",
        recordId: "record-1",
      });
    });

    expect(selectSingle).toHaveBeenCalled();
    expect(deleteFn).toHaveBeenCalled();
    expect(deleteEq).toHaveBeenCalledWith("id", "cr-1");
  });

  it("throws when fallback delete fails", async () => {
    const selectSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const selectEq = vi.fn(() => ({ single: selectSingle }));
    const select = vi.fn(() => ({ eq: selectEq }));
    const deleteEq = vi.fn().mockResolvedValue({ data: null, error: { message: "delete failed" } });
    const deleteFn = vi.fn(() => ({ eq: deleteEq }));
    const fromMock = vi
      .fn()
      .mockImplementation(() =>
        fromMock.mock.calls.length === 1
          ? { select, delete: vi.fn(() => ({ eq: vi.fn() })) }
          : { delete: deleteFn },
      );
    createClientMock.mockReturnValue({ from: fromMock });

    const { useDeleteConditionRecord } = await import("./use-conditions");
    const { result } = renderHookWithQueryClient(() => useDeleteConditionRecord());

    await expect(
      result.current.mutateAsync({
        id: "cr-fail",
        recordId: "record-1",
      }),
    ).rejects.toThrow("delete failed");
  });

  it("links condition records without condition update when record is older and no code is provided", async () => {
    const conditionRecordsBuilder = createQueryBuilder({
      data: {
        id: "cr-link-2",
        record_id: "record-old",
        condition_id: "cond-1",
      },
      error: null,
    });
    vi.mocked(conditionRecordsBuilder.single)
      .mockResolvedValueOnce({
        data: { id: "cr-link-2", record_id: "record-old", condition_id: "cond-1" },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { medical_records: { record_date: "2026-03-01" } },
        error: null,
      });

    const medicalRecordsBuilder = createQueryBuilder({
      data: { record_date: "2026-01-01" },
      error: null,
    });
    const conditionsBuilder = createQueryBuilder({
      data: conditionRow(),
      error: null,
    });

    createClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "condition_records") return conditionRecordsBuilder;
        if (table === "medical_records") return medicalRecordsBuilder;
        return conditionsBuilder;
      }),
    });

    const { useLinkConditionToRecord } = await import("./use-conditions");
    const { result } = renderHookWithQueryClient(() => useLinkConditionToRecord());

    await act(async () => {
      await result.current.mutateAsync({
        condition_id: "cond-1",
        record_id: "record-old",
        status_in_record: "resolved",
      });
    });

    expect(conditionsBuilder.update).not.toHaveBeenCalled();
    expect(conditionRecordsBuilder.insert).toHaveBeenCalled();
  });

  it("does not let a suppressed closure outrank a manual link by date", async () => {
    // The manual-link path compares dates itself instead of calling the recompute helper, so it
    // needs the same filter. A machine closure it cannot apply must not be counted as the newest
    // word either: doing so would refuse the person's own confirmed status and leave the
    // condition stale until that draft is reviewed -- or for good, if it never is.
    const conditionRecordsBuilder = createQueryBuilder({
      data: { id: "cr-new", record_id: "record-1", condition_id: "cond-1" },
      error: null,
    });
    const medicalRecordsBuilder = createQueryBuilder({
      data: { record_date: "2026-01-01" },
      error: null,
    });
    const conditionsBuilder = createQueryBuilder({ data: conditionRow(), error: null });

    createClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "condition_records") return conditionRecordsBuilder;
        if (table === "medical_records") return medicalRecordsBuilder;
        return conditionsBuilder;
      }),
    });

    const { useLinkConditionToRecord } = await import("./use-conditions");
    const { result } = renderHookWithQueryClient(() => useLinkConditionToRecord());

    await act(async () => {
      await result.current.mutateAsync({
        condition_id: "cond-1",
        record_id: "record-1",
        status_in_record: "active",
      });
    });

    expect(conditionRecordsBuilder.or).toHaveBeenCalledWith(AUTHORITATIVE_STATUS_FILTER);
  });

  it("fails the verification when the recompute it depends on fails", async () => {
    // The mention is verified by the time the recompute runs, and verifyAllConditions only
    // revisits unverified rows -- so a swallowed failure would report success and never be
    // retried, leaving an approved closure that never reaches the chart.
    const conditionRecordsBuilder = createQueryBuilder({
      data: { id: "cr-1", record_id: "record-1", condition_id: "cond-1" },
      error: null,
    });
    vi.mocked(conditionRecordsBuilder.maybeSingle).mockResolvedValue({
      data: null,
      error: { message: "recompute select failed" },
    });
    const conditionsBuilder = createQueryBuilder({ data: conditionRow(), error: null });

    createClientMock.mockReturnValue({
      from: vi.fn((table: string) =>
        table === "condition_records" ? conditionRecordsBuilder : conditionsBuilder,
      ),
    });

    const { useUpdateConditionRecord } = await import("./use-conditions");
    const { result } = renderHookWithQueryClient(() => useUpdateConditionRecord());

    await act(async () => {
      await expect(
        result.current.mutateAsync({
          id: "cr-1",
          updates: { is_user_verified: true },
        }),
      ).rejects.toThrow("recompute select failed");
    });
  });

  it("handles query errors, null detail states, and disabled hooks", async () => {
    const errorBuilder = createQueryBuilder({
      data: null,
      error: { message: "conditions fetch failed" },
    });
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "history rpc failed" },
    });
    createClientMock.mockReturnValue({
      from: vi.fn(() => errorBuilder),
      rpc,
    });

    const { usePersonConditions, usePersonConditionsWithHistory, useConditionDetail } =
      await import("./use-conditions");
    const listError = renderHookWithQueryClient(() => usePersonConditions("person-1"));
    const historyError = renderHookWithQueryClient(() =>
      usePersonConditionsWithHistory("person-1"),
    );
    const detailNull = renderHookWithQueryClient(() => useConditionDetail("cond-1"));
    const listDisabled = renderHookWithQueryClient(() => usePersonConditions(null));
    const detailDisabled = renderHookWithQueryClient(() => useConditionDetail(null));

    await waitFor(() => expect(listError.result.current.isError).toBe(true));
    await waitFor(() => expect(historyError.result.current.isError).toBe(true));
    await waitFor(() => expect(detailNull.result.current.isSuccess).toBe(true));
    expect((listError.result.current.error as Error).message).toBe("conditions fetch failed");
    expect((historyError.result.current.error as Error).message).toBe("history rpc failed");
    expect(detailNull.result.current.data).toBeNull();
    expect(listDisabled.result.current.fetchStatus).toBe("idle");
    expect(detailDisabled.result.current.fetchStatus).toBe("idle");
  });

  it("propagates condition detail record errors", async () => {
    const conditionsBuilder = createQueryBuilder({
      data: conditionRow(),
      error: null,
    });
    const recordsErrorBuilder = createQueryBuilder({
      data: null,
      error: { message: "record history failed" },
    });
    createClientMock.mockReturnValue({
      from: vi.fn((table: string) =>
        table === "conditions" ? conditionsBuilder : recordsErrorBuilder,
      ),
    });

    const { useConditionDetail } = await import("./use-conditions");
    const { result } = renderHookWithQueryClient(() => useConditionDetail("cond-1"));

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toBe("record history failed");
  });

  it("propagates create-with-record errors and handles null record-date link branch", async () => {
    const createErrorBuilder = createQueryBuilder({
      data: null,
      error: { message: "create condition failed" },
    });
    createClientMock.mockReturnValue({
      from: vi.fn(() => createErrorBuilder),
    });

    const { useCreateConditionWithRecord } = await import("./use-conditions");
    const createHook = renderHookWithQueryClient(() => useCreateConditionWithRecord());
    await expect(
      createHook.result.current.mutateAsync({
        person_id: "person-1",
        record_id: "record-1",
        name: "Asthma",
        status: "active",
      }),
    ).rejects.toThrow("create condition failed");

    const conditionBuilder = createQueryBuilder({
      data: conditionRow(),
      error: null,
    });
    const conditionRecordsBuilder = createQueryBuilder({
      data: { id: "cr-link-3", record_id: "record-undated", condition_id: "cond-1" },
      error: null,
    });
    vi.mocked(conditionRecordsBuilder.single)
      .mockResolvedValueOnce({
        data: { id: "cr-link-3", record_id: "record-undated", condition_id: "cond-1" },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { medical_records: { record_date: "2026-03-01" } },
        error: null,
      });
    const medicalRecordsBuilder = createQueryBuilder({
      data: { record_date: null },
      error: null,
    });
    createClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "condition_records") return conditionRecordsBuilder;
        if (table === "medical_records") return medicalRecordsBuilder;
        return conditionBuilder;
      }),
    });

    const { useLinkConditionToRecord } = await import("./use-conditions");
    const linkHook = renderHookWithQueryClient(() => useLinkConditionToRecord());
    await act(async () => {
      await linkHook.result.current.mutateAsync({
        condition_id: "cond-1",
        record_id: "record-undated",
        status_in_record: "resolved",
        code: "J45",
        icd_name_en: "Asthma",
      });
    });

    // null record date disables status update, but code update still applies
    expect(conditionBuilder.update).toHaveBeenCalledWith({
      code: "J45",
      icd_name_en: "Asthma",
    });
  });
});

describe("verifying a lab-driven closure", () => {
  beforeEach(() => {
    createClientMock.mockReset();
  });

  /** The row the guard reads, plus the observations the record holds. */
  function stubFor(mention: Record<string, unknown>, observations: Record<string, unknown>[]) {
    const conditionRecordsBuilder = createQueryBuilder({
      data: { id: "cr-1", record_id: "record-1", condition_id: "cond-1" },
      error: null,
    });
    vi.mocked(conditionRecordsBuilder.single).mockResolvedValue({ data: mention, error: null });
    vi.mocked(conditionRecordsBuilder.maybeSingle).mockResolvedValue({
      data: { status_in_record: "resolved" },
      error: null,
    });
    const observationsBuilder = createQueryBuilder({ data: observations, error: null });
    const conditionsBuilder = createQueryBuilder({ data: conditionRow(), error: null });

    createClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "condition_records") return conditionRecordsBuilder;
        if (table === "record_observations") return observationsBuilder;
        return conditionsBuilder;
      }),
    });
    return { conditionRecordsBuilder, observationsBuilder, conditionsBuilder };
  }

  const closure = {
    status_in_record: "resolved",
    supporting_obs_code: "vitamin_b12",
    record_id: "record-1",
  };

  function observation(overrides: Record<string, unknown> = {}) {
    return {
      obs_code: "vitamin_b12",
      is_applied: true,
      value_numeric: 704,
      value_canonical: null,
      ref_range_low: 187,
      ref_range_high: 883,
      ref_range_low_canonical: null,
      ref_range_high_canonical: null,
      status: "normal",
      ...overrides,
    };
  }

  it("refuses when the cited measurement no longer supports it, whatever path asked", async () => {
    // The review found a third path with no guard of its own: the mention's editor writes
    // `is_user_verified: true` directly. The check lives at the mutation so that path cannot
    // route around it, and neither can the next one.
    const { conditionRecordsBuilder } = stubFor(closure, [
      observation({ value_numeric: 120, status: "low" }),
    ]);

    const { useUpdateConditionRecord } = await import("./use-conditions");
    const { result } = renderHookWithQueryClient(() => useUpdateConditionRecord());

    await expect(
      result.current.mutateAsync({
        id: "cr-1",
        updates: { status_in_record: "resolved", source_anchor: "x", is_user_verified: true },
      }),
    ).rejects.toThrow();

    expect(conditionRecordsBuilder.update).not.toHaveBeenCalled();
  });

  it("refuses when the cited measurement is gone from the record", async () => {
    const { conditionRecordsBuilder } = stubFor(closure, []);

    const { useUpdateConditionRecord } = await import("./use-conditions");
    const { result } = renderHookWithQueryClient(() => useUpdateConditionRecord());

    await expect(
      result.current.mutateAsync({ id: "cr-1", updates: { is_user_verified: true } }),
    ).rejects.toThrow();
    expect(conditionRecordsBuilder.update).not.toHaveBeenCalled();
  });

  it("verifies when the evidence still stands", async () => {
    const { conditionRecordsBuilder } = stubFor(closure, [observation()]);

    const { useUpdateConditionRecord } = await import("./use-conditions");
    const { result } = renderHookWithQueryClient(() => useUpdateConditionRecord());

    await act(async () => {
      await result.current.mutateAsync({ id: "cr-1", updates: { is_user_verified: true } });
    });

    expect(conditionRecordsBuilder.update).toHaveBeenCalledWith({
      is_user_verified: true,
      review_decision: "confirmed",
    });
  });

  it("does not read observations for a mention that cites none", async () => {
    // Ordinary mentions must not pay for the guard, and an unverifiable-by-construction row is
    // not the thing it protects.
    const { observationsBuilder, conditionRecordsBuilder } = stubFor(
      { status_in_record: "active", supporting_obs_code: null, record_id: "record-1" },
      [],
    );

    const { useUpdateConditionRecord } = await import("./use-conditions");
    const { result } = renderHookWithQueryClient(() => useUpdateConditionRecord());

    await act(async () => {
      await result.current.mutateAsync({ id: "cr-1", updates: { is_user_verified: true } });
    });

    expect(observationsBuilder.select).not.toHaveBeenCalled();
    expect(conditionRecordsBuilder.update).toHaveBeenCalled();
  });

  it("does not run at all when nothing is being verified", async () => {
    // A dismissal writes no verification, so it must not be made to justify one.
    const { conditionRecordsBuilder, observationsBuilder } = stubFor(closure, []);

    const { useUpdateConditionRecord } = await import("./use-conditions");
    const { result } = renderHookWithQueryClient(() => useUpdateConditionRecord());

    await act(async () => {
      await result.current.mutateAsync({
        id: "cr-1",
        updates: { review_decision: "dismissed" },
      });
    });

    expect(observationsBuilder.select).not.toHaveBeenCalled();
    expect(conditionRecordsBuilder.update).toHaveBeenCalledWith({ review_decision: "dismissed" });
  });
});
