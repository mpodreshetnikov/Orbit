import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import type { NotificationForDevice, NotificationsResponse } from "@/types";

export async function GET(request: Request) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");

  let fromDate: string;
  let toDate: string;

  if (fromParam && toParam) {
    fromDate = fromParam;
    toDate = toParam;
  } else {
    const now = new Date();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const end = new Date(now);
    end.setDate(end.getDate() + 1);
    fromDate = start.toISOString();
    toDate = end.toISOString();
  }

  const { data: rows, error } = await supabase
    .from("notification_digests")
    .select("id, type, scheduled_at, payload_json, person_id")
    .eq("auth_user_id", user.id)
    .is("sent_at", null)
    .gte("scheduled_at", fromDate)
    .lte("scheduled_at", toDate)
    .order("scheduled_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { data: routedPersons } = await supabase.rpc("get_routed_persons_for_recipient", {
    p_recipient_user_id: user.id,
  });
  const allowedPersonIds = new Set(
    (routedPersons ?? []).map((p: { person_id: string }) => p.person_id),
  );

  const notifications: NotificationForDevice[] = (rows ?? [])
    .filter((r) => {
      const personId = (r.person_id as string | null) ?? null;
      if (!personId) return true;
      return allowedPersonIds.has(personId);
    })
    .map((r) => {
      const payload = r.payload_json as {
        title?: string;
        body?: string;
        url?: string;
        person_id?: string | null;
        person_name?: string | null;
        title_prefix?: string | null;
        tag?: string | null;
      };
      return {
        id: r.id,
        type: r.type,
        title: payload?.title ?? "",
        body: payload?.body ?? "",
        url: payload?.url ?? "/",
        scheduledAt: r.scheduled_at,
        person_id: (r.person_id as string | null) ?? payload?.person_id ?? null,
        person_name: payload?.person_name ?? null,
        title_prefix: payload?.title_prefix ?? null,
        tag: payload?.tag ?? null,
      };
    });

  const response: NotificationsResponse = { notifications };
  return NextResponse.json(response);
}
