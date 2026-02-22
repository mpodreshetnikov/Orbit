import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import EditCheckupPage from "./page";

const routerMock = {
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  prefetch: vi.fn().mockResolvedValue(undefined),
};

const useCheckupItemMock = vi.fn();
const useUpdateCheckupItemMock = vi.fn();
const usePersonConditionsMock = vi.fn();

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
}));

vi.mock("@/hooks", () => ({
  useCheckupItem: (...args: unknown[]) => useCheckupItemMock(...args),
  useUpdateCheckupItem: (...args: unknown[]) => useUpdateCheckupItemMock(...args),
  usePersonConditions: (...args: unknown[]) => usePersonConditionsMock(...args),
}));

vi.mock("@/components/checkups", () => ({
  CheckupForm: ({
    onSubmit,
    onCancel,
  }: {
    onSubmit: (payload: Record<string, unknown>) => Promise<void>;
    onCancel: () => void;
  }) => (
    <div>
      checkup-form-edit
      <button
        type="button"
        onClick={() =>
          void onSubmit({
            title: "Updated",
          })
        }
      >
        submit-checkup-edit
      </button>
      <button type="button" onClick={onCancel}>
        cancel-checkup-edit
      </button>
    </div>
  ),
}));

function resolvedParams<T>(value: T): Promise<T> {
  return {
    then: (resolve: (v: T) => unknown) => resolve(value),
  } as unknown as Promise<T>;
}

describe("edit checkup page", () => {
  beforeEach(() => {
    routerMock.push.mockReset();
    useCheckupItemMock.mockReset();
    useUpdateCheckupItemMock.mockReset();
    usePersonConditionsMock.mockReset();

    usePersonConditionsMock.mockReturnValue({ data: [] });
    useUpdateCheckupItemMock.mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue(undefined),
      isPending: false,
    });
  });

  it("renders loading skeleton", () => {
    useCheckupItemMock.mockReturnValue({ data: null, isLoading: true, error: null });
    const { container } = render(<EditCheckupPage params={resolvedParams({ id: "checkup-1" })} />);
    expect(container.querySelector(".animate-pulse")).toBeTruthy();
  });

  it("renders error state when item is missing", () => {
    useCheckupItemMock.mockReturnValue({ data: null, isLoading: false, error: new Error("boom") });
    render(<EditCheckupPage params={resolvedParams({ id: "checkup-1" })} />);
    expect(screen.getByText("common.error")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "common.back" })).toHaveAttribute(
      "href",
      "/health/checkups",
    );
  });

  it("submits updates and supports cancel", async () => {
    const mutation = {
      mutateAsync: vi.fn().mockResolvedValue(undefined),
      isPending: false,
    };
    useUpdateCheckupItemMock.mockReturnValue(mutation);
    useCheckupItemMock.mockReturnValue({
      data: {
        id: "checkup-1",
        person_id: "person-1",
      },
      isLoading: false,
      error: null,
    });

    render(<EditCheckupPage params={resolvedParams({ id: "checkup-1" })} />);
    expect(screen.getByText("checkup-form-edit")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "submit-checkup-edit" }));
    await waitFor(() => {
      expect(mutation.mutateAsync).toHaveBeenCalledWith({
        id: "checkup-1",
        updates: { title: "Updated" },
      });
      expect(routerMock.push).toHaveBeenCalledWith("/health/checkups/checkup-1");
    });

    await user.click(screen.getByRole("button", { name: "cancel-checkup-edit" }));
    expect(routerMock.push).toHaveBeenCalledWith("/health/checkups/checkup-1");
  });
});
