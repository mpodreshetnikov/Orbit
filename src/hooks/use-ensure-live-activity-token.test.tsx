import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const watchPushToStartToken = vi.fn();
const isNativeIosLiveActivityAvailable = vi.fn();

vi.mock("@/lib/live-activity-plugin", () => ({
  isNativeIosLiveActivityAvailable: () => isNativeIosLiveActivityAvailable(),
  LiveActivity: {
    watchPushToStartToken: () => watchPushToStartToken(),
  },
}));

describe("useEnsureLiveActivityToken", () => {
  beforeEach(() => {
    watchPushToStartToken.mockReset();
    isNativeIosLiveActivityAvailable.mockReset();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("does nothing outside the native iOS shell", async () => {
    isNativeIosLiveActivityAvailable.mockReturnValue(false);
    const { useEnsureLiveActivityToken } = await import("./use-ensure-live-activity-token");
    renderHook(() => useEnsureLiveActivityToken());
    expect(watchPushToStartToken).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("posts the token when the native plugin returns one", async () => {
    isNativeIosLiveActivityAvailable.mockReturnValue(true);
    watchPushToStartToken.mockResolvedValue({
      token: "deadbeef",
      apnsEnvironment: "sandbox",
      bundleId: "com.podreshetnikov.orbit",
    });
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 204 }));

    const { useEnsureLiveActivityToken } = await import("./use-ensure-live-activity-token");
    renderHook(() => useEnsureLiveActivityToken());

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/notifications/live-activity-token",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            pushToStartToken: "deadbeef",
            bundleId: "com.podreshetnikov.orbit",
            apnsEnvironment: "sandbox",
          }),
        }),
      );
    });
  });
});
