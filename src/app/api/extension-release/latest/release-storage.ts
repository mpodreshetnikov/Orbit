import { createClient } from "@supabase/supabase-js";
import {
  normalizeExtensionRelease,
  serializeExtensionRelease,
} from "@/lib/import/extension-release";

const EXTENSION_RELEASE_BUCKET = "extension-releases";
const EXTENSION_RELEASE_LATEST_PATH = "latest.json";

function createPublicStorageClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  }

  return createClient(supabaseUrl, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export async function readLatestExtensionReleasePayload() {
  const supabase = createPublicStorageClient();
  const { data, error } = await supabase.storage
    .from(EXTENSION_RELEASE_BUCKET)
    .download(EXTENSION_RELEASE_LATEST_PATH);

  if (error || !data) {
    return null;
  }

  const rawText = await data.text();
  const normalized = normalizeExtensionRelease(JSON.parse(rawText));
  if (!normalized) {
    throw new Error("Published extension release metadata is invalid.");
  }

  return serializeExtensionRelease(normalized);
}
