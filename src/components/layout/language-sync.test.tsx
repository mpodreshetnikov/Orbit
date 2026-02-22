import React from "react";
import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { installCacheMock } from "../../../test/utils/web/mocks";
import { clearPersistedStore, resetZustandStore } from "../../../test/utils/web/store-reset";
import { useUIStore } from "@/stores/ui-store";

describe("LanguageSync", () => {
  beforeEach(() => {
    clearPersistedStore("app.settings");
    resetZustandStore(useUIStore);
    document.cookie = "app.lang=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/;";
  });

  it("writes language into cookie and Cache API", async () => {
    const { put } = installCacheMock();
    const { LanguageSync } = await import("./language-sync");

    render(<LanguageSync />);

    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(document.cookie).toContain("app.lang=en");

    const firstBody = put.mock.calls[0]?.[1];
    expect(firstBody).toBeInstanceOf(Response);
    await expect((firstBody as Response).text()).resolves.toBe("en");

    act(() => {
      useUIStore.getState().setLanguage("ru");
    });

    await waitFor(() => expect(put).toHaveBeenCalledTimes(2));
    expect(document.cookie).toContain("app.lang=ru");

    const secondBody = put.mock.calls[1]?.[1];
    await expect((secondBody as Response).text()).resolves.toBe("ru");
  });
});
