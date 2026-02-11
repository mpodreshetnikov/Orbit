/**
 * Ask the Service Worker to update or close medication notifications when
 * the given dose event(s) have been marked taken/skipped in the app.
 */
export function notifySwMedicationIntakeResolved(doseEventIds: string[]): void {
  if (typeof window === "undefined" || !doseEventIds.length) return;
  const controller = navigator.serviceWorker?.controller;
  if (!controller) return;
  controller.postMessage({
    type: "medicationIntakeResolved",
    dose_event_ids: doseEventIds,
  });
}
