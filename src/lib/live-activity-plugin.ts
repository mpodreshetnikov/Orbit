import { Capacitor, registerPlugin } from "@capacitor/core";
import type { PluginListenerHandle } from "@capacitor/core";
import type { ApnsEnvironment } from "@/types";

export interface LiveActivityTokenEvent {
  token: string;
  apnsEnvironment: ApnsEnvironment;
  bundleId: string;
}

export interface LiveActivityPlugin {
  /** Starts observing ActivityKit push-to-start token updates (iOS 17.2+). */
  watchPushToStartToken(): Promise<LiveActivityTokenEvent>;
  addListener(
    eventName: "pushToStartToken",
    listenerFunc: (event: LiveActivityTokenEvent) => void,
  ): Promise<PluginListenerHandle>;
  /** Debug-only: request a local Live Activity with sample content (no APNs). */
  startDebugActivity(options?: {
    medicationName?: string;
    amountLabel?: string;
  }): Promise<{ started: boolean }>;
}

const LiveActivity = registerPlugin<LiveActivityPlugin>("LiveActivity");

export function isNativeIosLiveActivityAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";
}

export { LiveActivity };
