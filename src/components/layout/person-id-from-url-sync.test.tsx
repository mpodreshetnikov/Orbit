import React from "react";
import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PersonIdFromUrlSync } from "./person-id-from-url-sync";

const navMocks = vi.hoisted(() => ({
  usePathname: vi.fn(),
  useRouter: vi.fn(),
  useSearchParams: vi.fn(),
}));

const storeMocks = vi.hoisted(() => ({
  setSelectedPersonId: vi.fn(),
}));

const replaceMock = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => navMocks.usePathname(),
  useRouter: () => navMocks.useRouter(),
  useSearchParams: () => navMocks.useSearchParams(),
}));

vi.mock("@/stores/ui-store", () => ({
  useUIStore: (selector: (state: { setSelectedPersonId: (id: string) => void }) => unknown) =>
    selector({
      setSelectedPersonId: storeMocks.setSelectedPersonId,
    }),
}));

describe("PersonIdFromUrlSync", () => {
  beforeEach(() => {
    replaceMock.mockReset();
    storeMocks.setSelectedPersonId.mockReset();
    navMocks.usePathname.mockReturnValue("/health/records");
    navMocks.useRouter.mockReturnValue({ replace: replaceMock });
  });

  it("does nothing when personId is missing", async () => {
    navMocks.useSearchParams.mockReturnValue(new URLSearchParams("foo=bar"));

    render(<PersonIdFromUrlSync />);
    await waitFor(() => expect(storeMocks.setSelectedPersonId).not.toHaveBeenCalled());
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("does nothing when personId is blank", async () => {
    navMocks.useSearchParams.mockReturnValue(new URLSearchParams("personId=   &foo=bar"));

    render(<PersonIdFromUrlSync />);
    await waitFor(() => expect(storeMocks.setSelectedPersonId).not.toHaveBeenCalled());
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("syncs trimmed personId and cleans url query param", async () => {
    navMocks.useSearchParams.mockReturnValue(new URLSearchParams("foo=bar&personId=  p-42  "));

    render(<PersonIdFromUrlSync />);

    await waitFor(() => {
      expect(storeMocks.setSelectedPersonId).toHaveBeenCalledWith("p-42");
      expect(replaceMock).toHaveBeenCalledWith("/health/records?foo=bar", { scroll: false });
    });
  });
});
