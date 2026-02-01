import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

/**
 * POST /api/medications/run-cron
 * Run medication event generator + refill digests for current user, then invoke notifications-cron.
 * Body: optional { timezone?: string }. When provided, future scheduled/sent events are cleared
 * and regenerated in that timezone (fixes wrong-TZ intakes when user runs from debug UI).
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

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceRoleKey) {
      return NextResponse.json(
        { error: "Server configuration error: missing Supabase URL or service role key" },
        { status: 500 }
      );
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

    let eventsGenerated = 0;
    let refillDigestsCreated = 0;
    let eventsCleared = 0;

    if (typeof body.timezone === "string" && body.timezone.trim()) {
      const { data: cleared, error: clearError } = await supabase.rpc("clear_future_med_dose_events", {
        p_auth_user_id: user.id,
        p_horizon_days: 7,
      });
      if (!clearError && typeof cleared === "number") eventsCleared = cleared;
    }

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
  eventsGenerated = typeof genData === "number" ? genData : 0;

  const { data: refillData, error: refillError } = await supabase.rpc(
    "create_medication_refill_digests",
    { p_auth_user_id: user.id }
  );
  if (!refillError && typeof refillData === "number") {
    refillDigestsCreated = refillData;
  }

  const functionUrl = `${url}/functions/v1/notifications-cron`;
  try {
    const res = await fetch(functionUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceRoleKey}`,
      },
    });
    const raw = await res.text();
    let data: Record<string, unknown> = {};
    try {
      if (raw.length > 0 && raw.trimStart().startsWith("{")) {
        data = JSON.parse(raw) as Record<string, unknown>;
      }
    } catch {
      // Response was HTML or invalid JSON (e.g. gateway error page)
      if (!res.ok) {
        return NextResponse.json(
          {
            error: "Cron function returned non-JSON response",
            details: raw.slice(0, 200),
            eventsGenerated,
            refillDigestsCreated,
          },
          { status: res.status }
        );
      }
    }
    if (!res.ok) {
      return NextResponse.json(
        { error: (data as { error?: string }).error ?? "Cron function failed", details: data, eventsGenerated, refillDigestsCreated },
        { status: res.status }
      );
    }
    return NextResponse.json({
      ok: true,
      eventsGenerated,
      eventsCleared,
      refillDigestsCreated,
      timezone: tz,
      cron: data,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to invoke notifications-cron", details: message, eventsGenerated: 0, refillDigestsCreated: 0 },
      { status: 500 }
    );
  }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: "Medication cron failed", details: message, eventsGenerated: 0, refillDigestsCreated: 0 },
      { status: 500 }
    );
  }
}
