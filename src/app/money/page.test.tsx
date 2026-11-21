import { describe, expect, it, vi } from "vitest";
import MoneyHome from "./page";

const redirectMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

describe("MoneyHome", () => {
  it("redirects to reports", () => {
    expect(MoneyHome()).toBeUndefined();
    expect(redirectMock).toHaveBeenCalledWith("/money/reports");
  });
});
