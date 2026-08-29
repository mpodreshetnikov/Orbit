import type { CapacitorConfig } from "@capacitor/cli";
import { buildCapacitorConfig } from "./native/ios/capacitor-config.ts";

// Capacitor evaluates this file on the Mac, at `cap sync` and `cap open` time. Every decision it
// encodes — the bundle identifier, the origin the web view loads, whether cleartext is allowed —
// lives in native/ios/capacitor-config.ts instead, where it is covered by tests that run on any
// platform, including CI, which has no Xcode and cannot check the generated project.
const config: CapacitorConfig = buildCapacitorConfig();

export default config;
