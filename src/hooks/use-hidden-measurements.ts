"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase";
import {
  hiddenCodesForPerson,
  normalizeHiddenMeasurementCodes,
  toggleHiddenCode,
  type HiddenMeasurementCodes,
} from "@/lib/measurement-visibility";
import { useUserPreferences, USER_PREFERENCES_QUERY_KEY } from "./use-user-preferences";

async function persistHiddenMeasurementCodes(
  hidden: HiddenMeasurementCodes,
): Promise<HiddenMeasurementCodes> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data, error } = await supabase
    .from("user_preferences")
    .upsert(
      { auth_user_id: user.id, hidden_measurement_codes: hidden },
      { onConflict: "auth_user_id" },
    )
    .select()
    .single();

  if (error) throw new Error(error.message);

  return normalizeHiddenMeasurementCodes(data.hidden_measurement_codes);
}

/**
 * Hidden measurement types for one person, plus a toggle.
 *
 * The whole jsonb blob is read-modify-written, so each toggle must build on the
 * result of the previous one rather than on whatever the server last returned.
 * `pendingHidden` holds that locally-known-latest map: it is set synchronously
 * on every toggle and only cleared once the last in-flight write has settled
 * and the refetch behind it has landed. Without it, a second toggle fired
 * before the first settles would read pre-toggle state and drop the earlier
 * change -- including on the very first write, where there is no cached
 * preferences row to patch at all.
 *
 * It also doubles as the optimistic UI: `hiddenCodes` reads through it, so the
 * card disappears on click rather than after the round trip.
 *
 * This deliberately does not reuse `useUpdateUserPreferences` -- that hook is
 * shared with the settings and medications pages, which should not inherit
 * optimistic behavior.
 *
 * Note this makes concurrent toggles safe within one tab only. Two tabs, or
 * responses arriving out of order, can still lose a write, because the upsert
 * replaces the document rather than merging server-side.
 */
export function useHiddenMeasurements(personId: string | null) {
  const queryClient = useQueryClient();
  const { data: preferences, isLoading } = useUserPreferences();
  const [pendingHidden, setPendingHidden] = useState<HiddenMeasurementCodes | null>(null);
  const inFlight = useRef(0);
  // Mirrors pendingHidden, but updated synchronously: two toggles fired in the
  // same tick share one `toggleHidden` closure and would otherwise both compute
  // from the same pre-toggle base, so the second would overwrite the first.
  const pendingRef = useRef<HiddenMeasurementCodes | null>(null);

  const serverHidden = preferences?.hidden_measurement_codes;
  const allHidden = useMemo(
    () => pendingHidden ?? serverHidden ?? {},
    [pendingHidden, serverHidden],
  );

  const hiddenCodes = useMemo(
    () => hiddenCodesForPerson(allHidden, personId),
    [allHidden, personId],
  );

  const mutation = useMutation({
    mutationFn: persistHiddenMeasurementCodes,
    onError: () => {
      // Drop the optimistic overlay so the list falls back to server state.
      pendingRef.current = null;
      setPendingHidden(null);
    },
    onSettled: async () => {
      inFlight.current -= 1;
      // Await the refetch before clearing, so the list never flashes back to
      // the pre-toggle value in the gap between clearing and the row landing.
      await queryClient.invalidateQueries({ queryKey: [USER_PREFERENCES_QUERY_KEY] });
      if (inFlight.current === 0) {
        pendingRef.current = null;
        setPendingHidden(null);
      }
    },
  });

  const { mutate } = mutation;
  const toggleHidden = useCallback(
    (code: string) => {
      if (!personId) return;
      const base = pendingRef.current ?? serverHidden ?? {};
      const next = toggleHiddenCode(base, personId, code);
      pendingRef.current = next;
      setPendingHidden(next);
      inFlight.current += 1;
      mutate(next);
    },
    [mutate, personId, serverHidden],
  );

  return {
    hiddenCodes,
    toggleHidden,
    isLoading,
    isToggling: mutation.isPending,
  };
}
