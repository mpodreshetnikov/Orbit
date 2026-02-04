import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

/**
 * POST /api/medications/regenerate-events
 * Clear future scheduled/sent dose events and regenerate for the next 7 days.
 * Use after creating or editing a regimen so intakes (Today's intakes) are up to date.
 * Body: optional { timezone?: string; person_id?: string }.
 * - When person_id is provided: regenerate events for that person only (so intakes
 *   are generated even when the person is not linked to the current user).
 * - When person_id is omitted: regenerate for all persons linked to the current user.
 * Timezone: when omitted, uses user_preferences checkup_notification_timezone or UTC.
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

    let body: { timezone?: string; person_id?: string } = {};
    try {
      const raw = await request.text();
      if (raw?.trim()) body = JSON.parse(raw) as { timezone?: string; person_id?: string };
    } catch {
      // ignore invalid body
    }

    const prefsTz =
      (await supabase
        .from("user_preferences")
        .select("checkup_notification_timezone")
        .eq("auth_user_id", user.id)
        .maybeSingle())
        .data?.checkup_notification_timezone ?? null;

    const clientTz =
      typeof body.timezone === "string" && body.timezone.trim()
        ? body.timezone.trim()
        : null;

    const tz = clientTz ?? prefsTz ?? "UTC";

    // Persist client timezone to user_preferences so cron uses the same timezone.
    // This prevents duplicate events at different times when cron runs with UTC
    // while client uses the actual local timezone.
    if (clientTz && clientTz !== prefsTz) {
      await supabase
        .from("user_preferences")
        .upsert(
          { auth_user_id: user.id, checkup_notification_timezone: clientTz },
          { onConflict: "auth_user_id" }
        );
    }

    const horizonDays = 7;

    if (typeof body.person_id === "string" && body.person_id.trim()) {
      const personId = body.person_id.trim();
      const { data: person, error: personError } = await supabase
        .from("persons")
        .select("id")
        .eq("id", personId)
        .maybeSingle();
      if (personError || !person) {
        return NextResponse.json(
          { error: "Person not found or access denied" },
          { status: 404 }
        );
      }
      const { data: cleared, error: clearError } = await supabase.rpc(
        "clear_future_med_dose_events_for_person",
        { p_person_id: personId, p_horizon_days: horizonDays }
      );
      const eventsCleared = !clearError && typeof cleared === "number" ? cleared : 0;
      const { data: genData, error: genError } = await supabase.rpc(
        "generate_med_dose_events_for_horizon_for_person",
        { p_person_id: personId, p_timezone: tz, p_horizon_days: horizonDays }
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
        person_id: personId,
      });
    }

    const { data: cleared, error: clearError } = await supabase.rpc(
      "clear_future_med_dose_events",
      { p_auth_user_id: user.id, p_horizon_days: horizonDays }
    );
    const eventsCleared = !clearError && typeof cleared === "number" ? cleared : 0;

    const { data: genData, error: genError } = await supabase.rpc(
      "generate_med_dose_events_for_horizon",
      { p_auth_user_id: user.id, p_timezone: tz, p_horizon_days: horizonDays }
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
