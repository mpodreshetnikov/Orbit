import { preprocessOcrImage } from "./image-preprocess.ts";
import { createOpenRouterOcrClient } from "./openrouter-client.ts";
import { createSupabaseHealthOcrRepository } from "./repository.ts";

const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_OCR_ERROR_LENGTH = 500;
const DEFAULT_TITLE = "Медицинский документ";

function numberFromEnv(name: string): number | undefined {
  const raw = Deno.env.get(name);
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function createDefaultHealthOcrDeps() {
  return {
    config: {
      openRouterApiKey: OPENROUTER_API_KEY,
      supabaseUrl: SUPABASE_URL,
      supabaseAnonKey: SUPABASE_ANON_KEY,
      supabaseServiceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
    },
    maxAttachmentBytes: MAX_ATTACHMENT_BYTES,
    maxOcrErrorLength: MAX_OCR_ERROR_LENGTH,
    defaultTitle: DEFAULT_TITLE,
    createRepository(_authToken: string) {
      if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
        throw new Error("Supabase environment not configured");
      }
      return createSupabaseHealthOcrRepository({
        supabaseUrl: SUPABASE_URL,
        supabaseAnonKey: SUPABASE_ANON_KEY,
        supabaseServiceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
      });
    },
    openRouterClient: OPENROUTER_API_KEY
      ? createOpenRouterOcrClient({
          fetchFn: globalThis.fetch,
          apiKey: OPENROUTER_API_KEY,
          referer: SUPABASE_URL || "http://localhost:3000",
          model: Deno.env.get("OPENROUTER_HEALTH_OCR_MODEL") ?? undefined,
          timeoutMs: numberFromEnv("OPENROUTER_HEALTH_OCR_TIMEOUT_MS"),
          maxTokens: numberFromEnv("OPENROUTER_HEALTH_OCR_MAX_TOKENS"),
          log: console,
        })
      : null,
    // The deployed function is the only caller that reaches the image codec; tests that want
    // preprocessing inject their own.
    preprocessImage: preprocessOcrImage,
    log: console,
    now: () => Date.now(),
  };
}

export type HealthOcrDeps = ReturnType<typeof createDefaultHealthOcrDeps>;
