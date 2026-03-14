import { describe, expect, it, vi } from "vitest";
import MoneyHome from "./page";

const redirectMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

describe("MoneyHome", () => {
  it("redirects to reports", () => {
    MoneyHome();

    expect(redirectMock).toHaveBeenCalledWith("/money/reports");
  });
});
