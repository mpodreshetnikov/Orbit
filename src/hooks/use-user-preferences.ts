"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase";
import type { UserPreferences, UpdateUserPreferencesInput } from "@/types";

const QUERY_KEY = "user-preferences";

async function fetchUserPreferences(): Promise<UserPreferences | null> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from("user_preferences")
    .select("*")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;

  return {
    auth_user_id: data.auth_user_id as string,
    checkup_notification_time: data.checkup_notification_time as string,
    checkup_notification_timezone: (data.checkup_notification_timezone as string | null) ?? null,
    created_at: data.created_at as string,
    updated_at: data.updated_at as string,
  };
}

export function useUserPreferences() {
  return useQuery({
    queryKey: [QUERY_KEY],
    queryFn: fetchUserPreferences,
  });
}

async function updateUserPreferences(
  input: UpdateUserPreferencesInput
): Promise<UserPreferences> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const payload: Record<string, unknown> = {};
  if (input.checkup_notification_time !== undefined)
    payload.checkup_notification_time = input.checkup_notification_time;
  if (input.checkup_notification_timezone !== undefined)
    payload.checkup_notification_timezone = input.checkup_notification_timezone;

  const { data, error } = await supabase
    .from("user_preferences")
    .upsert(
      { auth_user_id: user.id, ...payload },
      { onConflict: "auth_user_id" }
    )
    .select()
    .single();

  if (error) throw new Error(error.message);

  return {
    auth_user_id: data.auth_user_id as string,
    checkup_notification_time: data.checkup_notification_time as string,
    checkup_notification_timezone: (data.checkup_notification_timezone as string | null) ?? null,
    created_at: data.created_at as string,
    updated_at: data.updated_at as string,
  };
}

export function useUpdateUserPreferences() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateUserPreferences,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
    },
  });
}
