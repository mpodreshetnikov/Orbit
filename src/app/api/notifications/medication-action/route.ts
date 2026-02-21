import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    console.warn("[medication-action] Unauthorized:", authError?.message ?? "no user");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { dose_event_ids?: string[]; action?: string; raw_event_action?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const doseEventIds = body.dose_event_ids;
  const action = body.action;

  // Short diagnostic log (won't be truncated by Vercel)
  console.log("[med-act]", action, "raw:", body.raw_event_action);
  console.log(
    "[medication-action] user:",
    user.id,
    "action:",
    JSON.stringify(action),
    "dose_event_ids:",
    JSON.stringify(doseEventIds),
  );

  if (!Array.isArray(doseEventIds) || doseEventIds.length === 0) {
    return NextResponse.json({ error: "Missing or empty dose_event_ids" }, { status: 400 });
  }
  if (action !== "taken" && action !== "skipped") {
    return NextResponse.json({ error: "action must be 'taken' or 'skipped'" }, { status: 400 });
  }

  const rpcName = action === "taken" ? "mark_dose_taken" : "mark_dose_skipped";
  console.log("[medication-action] calling RPC:", rpcName, "for", doseEventIds.length, "dose(s)");
  const nowIso = new Date().toISOString();
  for (const id of doseEventIds) {
    if (typeof id !== "string" || !id) continue;
    const rpcPayload =
      action === "taken" ? { p_dose_event_id: id, p_taken_at: nowIso } : { p_dose_event_id: id };
    const { error: rpcError } = await supabase.rpc(rpcName, rpcPayload);
    if (rpcError) {
      console.error("[medication-action] RPC error for", id, ":", rpcError.message);
    }
  }

  return new NextResponse(null, { status: 204 });
}
