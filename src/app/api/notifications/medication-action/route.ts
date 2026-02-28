import { NextResponse } from "next/server";
import { generateRequestId } from "@shared/lib/observability/correlation";
import { createServerLogger } from "@/lib/observability/server-logger";
import { withServerSpan } from "@/lib/observability/server-otel";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export async function POST(request: Request) {
  return withServerSpan("api.notifications.medication_action", async () => {
    const requestId = request.headers.get("x-request-id") ?? generateRequestId();
    const logger = createServerLogger({
      component: "notifications-medication-action",
      requestId,
    });
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      logger.warn("medication_action_unauthorized", {
        auth_error: authError?.message ?? "no user",
      });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let body: { dose_event_ids?: string[]; action?: string; raw_event_action?: string };
    try {
      body = await request.json();
    } catch {
      logger.warn("medication_action_invalid_json");
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const doseEventIds = body.dose_event_ids;
    const action = body.action;
    logger.info("medication_action_received", {
      auth_user_id: user.id,
      action: action ?? "unknown",
      dose_event_count: Array.isArray(doseEventIds) ? doseEventIds.length : 0,
      raw_event_action: body.raw_event_action ?? "none",
    });

    if (!Array.isArray(doseEventIds) || doseEventIds.length === 0) {
      logger.warn("medication_action_invalid_dose_event_ids");
      return NextResponse.json({ error: "Missing or empty dose_event_ids" }, { status: 400 });
    }
    if (action !== "taken" && action !== "skipped") {
      logger.warn("medication_action_invalid_action", { action: action ?? "unknown" });
      return NextResponse.json({ error: "action must be 'taken' or 'skipped'" }, { status: 400 });
    }

    const rpcName = action === "taken" ? "mark_dose_taken" : "mark_dose_skipped";
    const nowIso = new Date().toISOString();
    for (const id of doseEventIds) {
      if (typeof id !== "string" || !id) continue;
      const rpcPayload =
        action === "taken" ? { p_dose_event_id: id, p_taken_at: nowIso } : { p_dose_event_id: id };
      const { error: rpcError } = await supabase.rpc(rpcName, rpcPayload);
      if (rpcError) {
        logger.error("medication_action_rpc_error", {
          attrs: { rpc_name: rpcName, dose_event_id: id },
          error: { name: "SupabaseRpcError", message: rpcError.message },
        });
      }
    }

    logger.info("medication_action_completed", {
      rpc_name: rpcName,
      dose_event_count: doseEventIds.length,
    });

    return new NextResponse(null, { status: 204 });
  });
}
