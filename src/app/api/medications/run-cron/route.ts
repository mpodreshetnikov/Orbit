import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

/**
 * POST /api/medications/run-cron
 * Run medication event generator + refill digests for all users (same as pg_cron),
 * then invoke notifications-cron.
 */
export async function POST() {
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

    let eventsGenerated = 0;
    let refillDigestsCreated = 0;
    let usersProcessed = 0;

    const { data: genRows, error: genError } = await supabase.rpc(
      "run_med_event_generation_for_all_users",
      { p_horizon_days: 7 }
    );
    if (genError) {
      return NextResponse.json(
        { error: "Event generator failed", details: genError.message },
        { status: 500 }
      );
    }
    if (Array.isArray(genRows)) {
      usersProcessed = genRows.length;
      for (const row of genRows as { events_generated?: number; refill_digests_created?: number }[]) {
        eventsGenerated += typeof row.events_generated === "number" ? row.events_generated : 0;
        refillDigestsCreated += typeof row.refill_digests_created === "number" ? row.refill_digests_created : 0;
      }
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
          {
            error: (data as { error?: string }).error ?? "Cron function failed",
            details: data,
            eventsGenerated,
            refillDigestsCreated,
          },
          { status: res.status }
        );
      }
      return NextResponse.json({
        ok: true,
        usersProcessed,
        eventsGenerated,
        refillDigestsCreated,
        cron: data,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return NextResponse.json(
        { error: "Failed to invoke notifications-cron", details: message, eventsGenerated, refillDigestsCreated },
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
