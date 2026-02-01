import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { dose_event_ids?: string[]; action?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const doseEventIds = body.dose_event_ids;
  const action = body.action;

  if (!Array.isArray(doseEventIds) || doseEventIds.length === 0) {
    return NextResponse.json(
      { error: "Missing or empty dose_event_ids" },
      { status: 400 }
    );
  }
  if (action !== "taken" && action !== "skipped") {
    return NextResponse.json(
      { error: "action must be 'taken' or 'skipped'" },
      { status: 400 }
    );
  }

  const rpcName = action === "taken" ? "mark_dose_taken" : "mark_dose_skipped";
  for (const id of doseEventIds) {
    if (typeof id !== "string" || !id) continue;
    await supabase.rpc(rpcName, { p_dose_event_id: id });
  }

  return new NextResponse(null, { status: 204 });
}
