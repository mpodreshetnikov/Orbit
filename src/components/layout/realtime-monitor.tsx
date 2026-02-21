"use client";

import { useProcessingMonitor } from "@/hooks";
import { useUIStore } from "@/stores/ui-store";

/**
 * This component subscribes to Supabase Realtime updates for medical records.
 * It should be mounted at the AppShell level to stay active across all health pages.
 *
 * When records finish processing (status changes from "processing" to "draft"),
 * it updates the processing queue store and shows a notification.
 */
export function RealtimeMonitor() {
  const selectedPersonId = useUIStore((state) => state.selectedPersonId);

  // Subscribe to realtime updates for the selected person
  useProcessingMonitor(selectedPersonId);

  // This component doesn't render anything
  return null;
}
