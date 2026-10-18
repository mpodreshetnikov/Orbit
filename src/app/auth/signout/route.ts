import { createServerSupabaseClient } from "@/lib/supabase-server";
import { NextResponse } from "next/server";
import { NextRequest } from "next/server";
import { getRequestOrigin } from "@/lib/request-origin";

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  await supabase.auth.signOut();

  return NextResponse.redirect(new URL("/login", getRequestOrigin(request)));
}
