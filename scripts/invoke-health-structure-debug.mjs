#!/usr/bin/env node
/**
 * Invoke health-structure for a record with debug=true to fetch raw_llm_response.
 * Usage:
 *   node scripts/invoke-health-structure-debug.mjs <record_id>
 * Requires one of:
 *   - HEALTH_STRUCTURE_JWT: Bearer token (e.g. from browser session after login)
 *   - Or HEALTH_STRUCTURE_EMAIL + HEALTH_STRUCTURE_PASSWORD for programmatic sign-in
 * Optional: SUPABASE_URL (default http://127.0.0.1:54321), SUPABASE_ANON_KEY for sign-in
 */
const recordId = process.argv[2];
if (!recordId) {
  console.error("Usage: node scripts/invoke-health-structure-debug.mjs <record_id>");
  process.exit(1);
}

const supabaseUrl =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const anonKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const jwt = process.env.HEALTH_STRUCTURE_JWT;
const email = process.env.HEALTH_STRUCTURE_EMAIL;
const password = process.env.HEALTH_STRUCTURE_PASSWORD;

async function getToken() {
  if (jwt) return jwt;
  if (email && password && anonKey) {
    const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: anonKey },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Sign-in failed: ${res.status} ${t}`);
    }
    const data = await res.json();
    return data.access_token;
  }
  return null;
}

async function main() {
  const token = await getToken();
  if (!token) {
    console.error(
      "Set HEALTH_STRUCTURE_JWT (Bearer token) or HEALTH_STRUCTURE_EMAIL + HEALTH_STRUCTURE_PASSWORD (and SUPABASE_ANON_KEY) in env.",
    );
    process.exit(1);
  }

  const url = `${supabaseUrl}/functions/v1/health-structure`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ record_id: recordId, debug: true }),
  });

  const payload = await res.json();
  if (!res.ok) {
    console.error("Request failed:", res.status, payload);
    process.exit(1);
  }

  if (payload.raw_llm_response != null) {
    console.log("--- raw_llm_response ---");
    console.log(payload.raw_llm_response);
    console.log("--- end ---");
  } else {
    console.log("No raw_llm_response in payload. Keys:", Object.keys(payload));
  }
  console.log(
    "structured_data.observations.length:",
    payload.structured_data?.observations?.length ?? 0,
  );
  console.log("structured_data.findings.length:", payload.structured_data?.findings?.length ?? 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
