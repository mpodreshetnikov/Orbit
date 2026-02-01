import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

/**
 * POST /api/medications/regenerate-events
 * Clear future scheduled/sent dose events for the current user and regenerate
 * for the next 7 days. Use after creating or editing a regimen so intakes
 * (Today's intakes) are up to date immediately.
 * Body: optional { timezone?: string }. When omitted, uses user_preferences
 * checkup_notification_timezone or UTC.
 */
export async function POST(request: Request) {
  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let body: { timezone?: string } = {};
    try {
      const raw = await request.text();
      if (raw?.trim()) body = JSON.parse(raw) as { timezone?: string };
    } catch {
      // ignore invalid body
    }

    const prefsTz =
      (await supabase
        .from("user_preferences")
        .select("checkup_notification_timezone")
        .eq("auth_user_id", user.id)
        .maybeSingle())
        .data?.checkup_notification_timezone ?? "UTC";

    const tz =
      typeof body.timezone === "string" && body.timezone.trim()
        ? body.timezone.trim()
        : (prefsTz ?? "UTC");

    const { data: cleared, error: clearError } = await supabase.rpc(
      "clear_future_med_dose_events",
      { p_auth_user_id: user.id, p_horizon_days: 7 }
    );
    const eventsCleared = !clearError && typeof cleared === "number" ? cleared : 0;

    const { data: genData, error: genError } = await supabase.rpc(
      "generate_med_dose_events_for_horizon",
      { p_auth_user_id: user.id, p_timezone: tz, p_horizon_days: 7 }
    );
    if (genError) {
      return NextResponse.json(
        { error: "Event generator failed", details: genError.message },
        { status: 500 }
      );
    }
    const eventsGenerated = typeof genData === "number" ? genData : 0;

    return NextResponse.json({
      ok: true,
      eventsCleared,
      eventsGenerated,
      timezone: tz,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: "Regenerate events failed", details: message },
      { status: 500 }
    );
  }
}
