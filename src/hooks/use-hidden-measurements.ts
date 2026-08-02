"use client";

import { useCallback, useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase";
import {
  hiddenCodesForPerson,
  normalizeHiddenMeasurementCodes,
  toggleHiddenCode,
  type HiddenMeasurementCodes,
} from "@/lib/measurement-visibility";
import { useUserPreferences, USER_PREFERENCES_QUERY_KEY } from "./use-user-preferences";
import type { UserPreferences } from "@/types";

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
 * The optimistic cache write in `onMutate` is a correctness requirement, not
 * polish: the whole jsonb blob is read-modify-written, so without it a second
 * toggle fired before the first settles would read pre-toggle state and drop
 * the earlier change.
 *
 * This deliberately does not reuse `useUpdateUserPreferences` -- that hook is
 * shared with the settings and medications pages, which should not inherit
 * optimistic behavior.
 */
export function useHiddenMeasurements(personId: string | null) {
  const queryClient = useQueryClient();
  const { data: preferences, isLoading } = useUserPreferences();

  const allHidden = useMemo(
    () => preferences?.hidden_measurement_codes ?? {},
    [preferences?.hidden_measurement_codes],
  );

  const hiddenCodes = useMemo(
    () => hiddenCodesForPerson(allHidden, personId),
    [allHidden, personId],
  );

  const mutation = useMutation({
    mutationFn: persistHiddenMeasurementCodes,
    onMutate: async (next: HiddenMeasurementCodes) => {
      await queryClient.cancelQueries({ queryKey: [USER_PREFERENCES_QUERY_KEY] });
      const previous = queryClient.getQueryData<UserPreferences | null>([
        USER_PREFERENCES_QUERY_KEY,
      ]);
      // No cached row yet (first ever preference write): nothing to patch, so
      // this one toggle falls back to invalidation latency.
      if (previous) {
        queryClient.setQueryData<UserPreferences>([USER_PREFERENCES_QUERY_KEY], {
          ...previous,
          hidden_measurement_codes: next,
        });
      }
      return { previous };
    },
    onError: (_error, _next, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData([USER_PREFERENCES_QUERY_KEY], context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: [USER_PREFERENCES_QUERY_KEY] });
    },
  });

  const { mutate } = mutation;
  const toggleHidden = useCallback(
    (code: string) => {
      if (!personId) return;
      mutate(toggleHiddenCode(allHidden, personId, code));
    },
    [allHidden, mutate, personId],
  );

  return {
    hiddenCodes,
    toggleHidden,
    isLoading,
    isToggling: mutation.isPending,
  };
}
