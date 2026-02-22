import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestQueryClient, createTestQueryWrapper } from "../../test/utils/web/render";
import { createQueryBuilder } from "../../test/utils/web/supabase-query";

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

describe("use-persons", () => {
  beforeEach(() => {
    createClientMock.mockReset();
  });

  it("fetches persons ordered by kind and name", async () => {
    const rows = [
      { id: "person-1", name: "Alex", kind: "human" },
      { id: "person-2", name: "Milo", kind: "pet" },
    ];
    const builder = createQueryBuilder({ data: rows, error: null });
    createClientMock.mockReturnValue({
      from: vi.fn(() => builder),
    });

    const { usePersons } = await import("./use-persons");
    const { result } = renderHookWithQueryClient(() => usePersons());

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(rows);
    expect(builder.order).toHaveBeenCalledWith("kind", { ascending: true });
    expect(builder.order).toHaveBeenCalledWith("name", { ascending: true });
  });

  it("returns query error", async () => {
    const builder = createQueryBuilder({
      data: null,
      error: { message: "persons failed" },
    });
    createClientMock.mockReturnValue({
      from: vi.fn(() => builder),
    });

    const { usePersons } = await import("./use-persons");
    const { result } = renderHookWithQueryClient(() => usePersons());

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toContain("persons failed");
  });
});
