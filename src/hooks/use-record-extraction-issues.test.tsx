import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createTestQueryClient, createTestQueryWrapper } from "../../test/utils/web/render";

const { createClientMock } = vi.hoisted(() => ({ createClientMock: vi.fn() }));

vi.mock("@/lib/supabase", () => ({ createClient: createClientMock }));

function renderHookWithQueryClient<T>(hook: () => T) {
  const queryClient = createTestQueryClient();
  return renderHook(hook, { wrapper: createTestQueryWrapper(queryClient) });
}

function createSupabaseMock(result: { data?: unknown; error?: { message: string } }) {
  const orderMock = vi
    .fn()
    .mockResolvedValue({ data: result.data ?? null, error: result.error ?? null });
  const eqMock = vi.fn(() => ({ order: orderMock }));
  const selectMock = vi.fn(() => ({ eq: eqMock }));
  const fromMock = vi.fn(() => ({ select: selectMock }));
  return { client: { from: fromMock }, fromMock, eqMock };
}

describe("use-record-extraction-issues", () => {
  beforeEach(() => {
    createClientMock.mockReset();
  });

  it("reads the record's corrections in the order they were made", async () => {
    const rows = [
      {
        id: "issue-1",
        record_id: "record-1",
        entity_kind: "observation",
        field: "observation.status",
        received: "borderline",
        resolution: "replaced_with_default",
        applied_fallback: "unknown",
        detail: null,
      },
    ];
    const { client, fromMock, eqMock } = createSupabaseMock({ data: rows });
    createClientMock.mockReturnValue(client);

    const { useRecordExtractionIssues } = await import("./use-record-extraction-issues");
    const { result } = renderHookWithQueryClient(() => useRecordExtractionIssues("record-1"));

    await waitFor(() => expect(result.current.data).toEqual(rows));
    expect(fromMock).toHaveBeenCalledWith("record_extraction_issues");
    expect(eqMock).toHaveBeenCalledWith("record_id", "record-1");
  });

  it("does not query without a record", async () => {
    const { client, fromMock } = createSupabaseMock({ data: [] });
    createClientMock.mockReturnValue(client);

    const { useRecordExtractionIssues } = await import("./use-record-extraction-issues");
    renderHookWithQueryClient(() => useRecordExtractionIssues(null));

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("surfaces a read failure rather than showing an empty list", async () => {
    const { client } = createSupabaseMock({ error: { message: "denied" } });
    createClientMock.mockReturnValue(client);

    const { useRecordExtractionIssues } = await import("./use-record-extraction-issues");
    const { result } = renderHookWithQueryClient(() => useRecordExtractionIssues("record-1"));

    // An empty list would read as "nothing was corrected", which is the opposite of unknown.
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
