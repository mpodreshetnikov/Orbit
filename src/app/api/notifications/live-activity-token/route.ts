import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import type { Database } from "@/types/database";
import type { LiveActivityTokenInput } from "@/types";

const APNS_ENVIRONMENTS = new Set(["sandbox", "production"]);
/** ActivityKit push-to-start tokens are hex; length varies by OS / device. */
const TOKEN_HEX_RE = /^[0-9a-fA-F]+$/;
const TOKEN_MIN_LEN = 16;
const TOKEN_MAX_LEN = 512;
const BUNDLE_ID_RE = /^[A-Za-z0-9.-]+$/;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function createServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) return null;
  return createClient<Database>(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Partial<LiveActivityTokenInput>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (
    !isNonEmptyString(body.pushToStartToken) ||
    !isNonEmptyString(body.bundleId) ||
    typeof body.apnsEnvironment !== "string" ||
    !APNS_ENVIRONMENTS.has(body.apnsEnvironment)
  ) {
    return NextResponse.json(
      { error: "Missing pushToStartToken, bundleId, or apnsEnvironment" },
      { status: 400 },
    );
  }

  const pushToStartToken = body.pushToStartToken.trim();
  const bundleId = body.bundleId.trim();
  const apnsEnvironment = body.apnsEnvironment;

  if (
    pushToStartToken.length < TOKEN_MIN_LEN ||
    pushToStartToken.length > TOKEN_MAX_LEN ||
    !TOKEN_HEX_RE.test(pushToStartToken)
  ) {
    return NextResponse.json({ error: "Invalid pushToStartToken" }, { status: 400 });
  }

  if (!BUNDLE_ID_RE.test(bundleId)) {
    return NextResponse.json({ error: "Invalid bundleId" }, { status: 400 });
  }

  // A physical device token must belong to one account: drop the same token from other users
  // before upserting for the caller (service role bypasses RLS).
  const admin = createServiceRoleClient();
  if (admin) {
    const { error: reclaimError } = await admin
      .from("live_activity_tokens")
      .delete()
      .eq("push_to_start_token", pushToStartToken)
      .neq("auth_user_id", user.id);
    if (reclaimError) {
      return NextResponse.json({ error: "Failed to register token" }, { status: 500 });
    }
  }

  const { error } = await supabase.from("live_activity_tokens").upsert(
    {
      auth_user_id: user.id,
      push_to_start_token: pushToStartToken,
      bundle_id: bundleId,
      apns_environment: apnsEnvironment,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "auth_user_id,push_to_start_token" },
  );

  if (error) {
    return NextResponse.json({ error: "Failed to register token" }, { status: 500 });
  }

  return new NextResponse(null, { status: 204 });
}
