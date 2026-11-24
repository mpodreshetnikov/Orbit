import React from "react";
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useUIStore } from "@/stores/ui-store";
import { PersonIdFromUrlSync } from "./person-id-from-url-sync";

const navMocks = vi.hoisted(() => ({
  usePathname: vi.fn(),
  useRouter: vi.fn(),
  useSearchParams: vi.fn(),
}));

const replaceMock = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => navMocks.usePathname(),
  useRouter: () => navMocks.useRouter(),
  useSearchParams: () => navMocks.useSearchParams(),
}));

describe("PersonIdFromUrlSync", () => {
  beforeEach(() => {
    replaceMock.mockReset();
    useUIStore.getState().setSelectedPersonId("p-current");
    navMocks.usePathname.mockReturnValue("/health/records");
    navMocks.useRouter.mockReturnValue({ replace: replaceMock });
  });

  it("does nothing when personId is missing", () => {
    navMocks.useSearchParams.mockReturnValue(new URLSearchParams("foo=bar"));

    render(<PersonIdFromUrlSync />);
    expect(useUIStore.getState().selectedPersonId).toBe("p-current");
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("does nothing when personId is blank", () => {
    navMocks.useSearchParams.mockReturnValue(new URLSearchParams("personId=   &foo=bar"));

    render(<PersonIdFromUrlSync />);
    expect(useUIStore.getState().selectedPersonId).toBe("p-current");
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("syncs trimmed personId and cleans url query param", () => {
    navMocks.useSearchParams.mockReturnValue(new URLSearchParams("foo=bar&personId=  p-42  "));

    render(<PersonIdFromUrlSync />);

    expect(useUIStore.getState().selectedPersonId).toBe("p-42");
    expect(replaceMock).toHaveBeenCalledExactlyOnceWith("/health/records?foo=bar", {
      scroll: false,
    });
  });
});
