import Constants from "expo-constants";
import { resolveInstanceConfig, type InstanceConfig } from "@/lib/instance-config";

let cached: InstanceConfig | null = null;

/**
 * The instance this build talks to, as Expo was configured with it.
 *
 * The one line in the app that reads `expo-constants`, kept apart from the validation in
 * `@/lib/instance-config` so that validation stays testable off-device. Throws with an actionable
 * message when the build was never pointed at an instance.
 */
export function instanceConfig(): InstanceConfig {
  cached ??= resolveInstanceConfig(Constants.expoConfig?.extra);
  return cached;
}
