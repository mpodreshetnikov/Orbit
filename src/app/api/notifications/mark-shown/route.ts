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

  let body: { id?: string; ids?: string[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const idsToMark = Array.isArray(body.ids) && body.ids.length > 0
    ? body.ids.filter((id): id is string => typeof id === "string" && id.length > 0)
    : typeof body.id === "string" && body.id
      ? [body.id]
      : null;

  if (!idsToMark || idsToMark.length === 0) {
    return NextResponse.json({ error: "Missing id or ids" }, { status: 400 });
  }

  const { error } = await supabase
    .from("notification_digests")
    .update({ sent_at: new Date().toISOString() })
    .in("id", idsToMark)
    .eq("auth_user_id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return new NextResponse(null, { status: 204 });
}
