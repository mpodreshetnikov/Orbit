export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * What a native client needs to reach this instance: the data API's address and its anon key.
 *
 * Both are public by construction — every browser that opens the web app receives them in its
 * bundle — so serving them here unauthenticated discloses nothing new. It lets the iOS client be
 * pointed at an instance by its address alone (`just mobile-start <domain>`, and later `M7` of
 * `T-261018-l19`, where the user types it), instead of someone copying the key out of a server's
 * `deploy/.env`. Under `/.well-known` because the middleware already lets that prefix through
 * without a session.
 */
export function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    return Response.json(
      { error: "This instance is not configured." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  return Response.json(
    { supabaseUrl, supabaseAnonKey },
    { headers: { "Cache-Control": "no-store" } },
  );
}
