import { describe, expect, it, vi } from "vitest";
import { notifySwMedicationIntakeResolved } from "./sw-messages";

describe("notifySwMedicationIntakeResolved", () => {
  it("no-ops when window is undefined", () => {
    const originalWindow = (globalThis as unknown as { window?: Window }).window;
    vi.stubGlobal("window", undefined as unknown as Window);

    expect(() => notifySwMedicationIntakeResolved(["dose-1"])).not.toThrow();

    vi.stubGlobal("window", originalWindow);
  });

  it("no-ops for empty ids and missing service worker controller", () => {
    const postMessage = vi.fn();
    if (!(globalThis as unknown as { navigator?: Navigator }).navigator) {
      vi.stubGlobal("navigator", {} as Navigator);
    }
    vi.stubGlobal("window", { navigator: globalThis.navigator } as Window & typeof globalThis);
    Object.defineProperty(globalThis.navigator, "serviceWorker", {
      configurable: true,
      value: { controller: null, postMessage },
    });

    notifySwMedicationIntakeResolved([]);
    notifySwMedicationIntakeResolved(["dose-1"]);

    expect(postMessage).not.toHaveBeenCalled();
  });

  it("posts message to active service worker controller", () => {
    const postMessage = vi.fn();
    if (!(globalThis as unknown as { navigator?: Navigator }).navigator) {
      vi.stubGlobal("navigator", {} as Navigator);
    }
    vi.stubGlobal("window", { navigator: globalThis.navigator } as Window & typeof globalThis);
    Object.defineProperty(globalThis.navigator, "serviceWorker", {
      configurable: true,
      value: { controller: { postMessage } },
    });

    notifySwMedicationIntakeResolved(["dose-1", "dose-2"]);

    expect(postMessage).toHaveBeenCalledWith({
      type: "medicationIntakeResolved",
      dose_event_ids: ["dose-1", "dose-2"],
    });
  });
});
