import type { ActiveRunRegistry } from "./active-runs.js";

/**
 * Applies a downloaded update only once no import is running. A browser that updates the add-on
 * itself -- Firefox from `update_url` -- restarts the background to do it, which would cut a
 * running import in half. With a `runtime.onUpdateAvailable` listener registered the browser holds
 * the new version back until the extension reloads itself, so this waits for the last run to end
 * and reloads then.
 */
export function applyUpdateWhenIdle(registry: ActiveRunRegistry, reload: () => void): void {
  if (registry.size() === 0) {
    reload();
    return;
  }
  const unsubscribe = registry.onChange((size) => {
    if (size > 0) return;
    unsubscribe();
    reload();
  });
}
