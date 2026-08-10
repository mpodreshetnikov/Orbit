import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import {
  DEFAULT_HORIZON_DAYS,
  regenerateDoseEvents,
} from "@/lib/medications/regenerate-dose-events";

/**
 * POST /api/medications/regenerate-events
 * Clear future scheduled/sent dose events and regenerate for the next 7 days.
 * Use after creating or editing a regimen so intakes (Today's intakes) are up to date.
 * Body: optional { timezone?: string; person_id?: string }.
 * - When person_id is provided: regenerate events for that person only (so intakes
 *   are generated even when the person is not linked to the current user).
 * - When person_id is omitted: regenerate for all persons linked to the current user.
 * Timezone: when omitted, uses user_preferences checkup_notification_timezone or UTC.
 *
 * The work itself lives in `@/lib/medications/regenerate-dose-events` so the MCP
 * medication tools can run the identical sequence with their own Supabase client.
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

    const personId =
      typeof body.person_id === "string" && body.person_id.trim() ? body.person_id.trim() : null;

    if (personId) {
      // Confirm the person is visible to this user before touching their events.
      const { data: person, error: personError } = await supabase
        .from("persons")
        .select("id")
        .eq("id", personId)
        .maybeSingle();
      if (personError || !person) {
        return NextResponse.json({ error: "Person not found or access denied" }, { status: 404 });
      }
    }

    const result = await regenerateDoseEvents(supabase, {
      authUserId: user.id,
      personId,
      timezone: body.timezone ?? null,
      horizonDays: DEFAULT_HORIZON_DAYS,
    });

    return NextResponse.json({
      ok: true,
      eventsCleared: result.eventsCleared,
      eventsGenerated: result.eventsGenerated,
      timezone: result.timezone,
      ...(personId ? { person_id: personId } : {}),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    if (message.startsWith("Event generator failed")) {
      return NextResponse.json(
        {
          error: "Event generator failed",
          details: message.replace("Event generator failed: ", ""),
        },
        { status: 500 },
      );
    }
    return NextResponse.json(
      { error: "Regenerate events failed", details: message },
      { status: 500 },
    );
  }
}
