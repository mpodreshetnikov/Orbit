import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import type { LiveActivityTokenInput } from "@/types";

const APNS_ENVIRONMENTS = new Set(["sandbox", "production"]);

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: LiveActivityTokenInput;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const pushToStartToken = body.pushToStartToken?.trim();
  const bundleId = body.bundleId?.trim();
  const apnsEnvironment = body.apnsEnvironment;

  if (!pushToStartToken || !bundleId || !APNS_ENVIRONMENTS.has(apnsEnvironment)) {
    return NextResponse.json(
      { error: "Missing pushToStartToken, bundleId, or apnsEnvironment" },
      { status: 400 },
    );
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
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return new NextResponse(null, { status: 204 });
}
