import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PersonSelector } from "./person-selector";

const hookMocks = vi.hoisted(() => ({
  usePersons: vi.fn(),
  useCurrentUser: vi.fn(),
  useUIStore: vi.fn(),
}));

const setSelectedPersonIdMock = vi.fn();

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/hooks", () => ({
  usePersons: (...args: unknown[]) => hookMocks.usePersons(...args),
  useCurrentUser: (...args: unknown[]) => hookMocks.useCurrentUser(...args),
}));

vi.mock("@/stores/ui-store", () => ({
  useUIStore: (...args: unknown[]) => hookMocks.useUIStore(...args),
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { asChild?: boolean; children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    onClick,
    disabled,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  DropdownMenuLabel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuSeparator: () => <hr />,
}));

describe("PersonSelector", () => {
  beforeEach(() => {
    setSelectedPersonIdMock.mockReset();
    hookMocks.useUIStore.mockImplementation((selector: (state: unknown) => unknown) =>
      selector({
        selectedPersonId: null,
        setSelectedPersonId: setSelectedPersonIdMock,
      }),
    );
    hookMocks.useCurrentUser.mockReturnValue({ data: { id: "user-1" } });
  });

  it("renders loading state while persons are loading", () => {
    hookMocks.usePersons.mockReturnValue({ data: undefined, isLoading: true });
    render(<PersonSelector />);

    expect(screen.getByText("common.loading")).toBeInTheDocument();
  });

  it("auto-selects the current user's own person and shows compact single-person state", async () => {
    hookMocks.usePersons.mockReturnValue({
      data: [
        {
          id: "person-1",
          name: "Alex",
          kind: "human",
          auth_user_id: "user-1",
          species: null,
        },
      ],
      isLoading: false,
    });

    render(<PersonSelector />);

    await waitFor(() => {
      expect(setSelectedPersonIdMock).toHaveBeenCalledWith("person-1");
    });
    expect(screen.getByText("Alex")).toBeInTheDocument();
    expect(screen.queryByText("person.select")).not.toBeInTheDocument();
  });

  it("renders grouped humans/pets and updates selected person from menu", async () => {
    const user = userEvent.setup();
    hookMocks.useUIStore.mockImplementation((selector: (state: unknown) => unknown) =>
      selector({
        selectedPersonId: "missing-person",
        setSelectedPersonId: setSelectedPersonIdMock,
      }),
    );
    hookMocks.usePersons.mockReturnValue({
      data: [
        {
          id: "person-1",
          name: "Alex",
          kind: "human",
          auth_user_id: "user-1",
          species: null,
        },
        {
          id: "person-2",
          name: "Sam",
          kind: "human",
          auth_user_id: null,
          species: null,
        },
        {
          id: "person-3",
          name: "Milo",
          kind: "pet",
          auth_user_id: null,
          species: "cat",
        },
      ],
      isLoading: false,
    });

    render(<PersonSelector />);

    expect(screen.getByText("person.humans")).toBeInTheDocument();
    expect(screen.getByText("person.pets")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Sam" }));
    await user.click(screen.getByRole("button", { name: /Milo\s*cat/ }));

    expect(setSelectedPersonIdMock).toHaveBeenCalledWith("person-1");
    expect(setSelectedPersonIdMock).toHaveBeenCalledWith("person-2");
    expect(setSelectedPersonIdMock).toHaveBeenCalledWith("person-3");
  });
});
