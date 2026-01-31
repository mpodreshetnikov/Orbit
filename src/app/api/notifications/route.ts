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
    .select("id, type, scheduled_at, payload_json")
    .eq("auth_user_id", user.id)
    .is("sent_at", null)
    .gte("scheduled_at", fromDate)
    .lte("scheduled_at", toDate)
    .order("scheduled_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const notifications: NotificationForDevice[] = (rows ?? []).map((r) => {
    const payload = r.payload_json as { title?: string; body?: string; url?: string };
    return {
      id: r.id,
      type: r.type,
      title: payload?.title ?? "",
      body: payload?.body ?? "",
      url: payload?.url ?? "/",
      scheduledAt: r.scheduled_at,
    };
  });

  const response: NotificationsResponse = { notifications };
  return NextResponse.json(response);
}
