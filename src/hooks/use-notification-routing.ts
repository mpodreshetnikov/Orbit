"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase";
import type { NotificationRoutingRow, NotificationRoutingUpsertInput } from "@/types";

const QUERY_KEY = "notification-routing";

export interface NotificationRoutingState {
  userId: string | null;
  rows: NotificationRoutingRow[];
}

async function fetchNotificationRouting(): Promise<NotificationRoutingState> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { userId: null, rows: [] };
  }

  const { data, error } = await supabase
    .from("notification_routing")
    .select("*")
    .eq("recipient_user_id", user.id)
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);

  return { userId: user.id, rows: (data as NotificationRoutingRow[]) ?? [] };
}

export function useNotificationRouting() {
  return useQuery({
    queryKey: [QUERY_KEY],
    queryFn: fetchNotificationRouting,
  });
}

async function upsertNotificationRouting(
  input: NotificationRoutingUpsertInput,
): Promise<NotificationRoutingRow> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  const payload = {
    recipient_user_id: user.id,
    person_id: input.person_id,
    enabled: input.enabled,
    custom_prefix: input.custom_prefix ?? null,
  };

  const { data, error } = await supabase
    .from("notification_routing")
    .upsert(payload, { onConflict: "recipient_user_id,person_id" })
    .select()
    .single();

  if (error) throw new Error(error.message);

  return data as NotificationRoutingRow;
}

export function useUpdateNotificationRouting() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: upsertNotificationRouting,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
    },
  });
}
