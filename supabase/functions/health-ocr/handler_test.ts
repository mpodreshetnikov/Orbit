// deno-lint-ignore-file require-await
import { assertEquals } from "std/assert/assert-equals";
import { corsHeaders } from "../_shared/cors.ts";
import { withEnv } from "../_shared/testing/env.ts";
import { assertJsonResponse } from "../_shared/testing/response.ts";
import { createHealthOcrHandler } from "./handler.ts";
import type { OpenRouterOcrClient } from "./openrouter-client.ts";
import type { HealthOcrRepository } from "./repository.ts";

function createRepositoryMock(): HealthOcrRepository {
  return {
    authenticateUser: async () => ({ id: "u1", email: "user@example.com" }),
    isAllowedUser: async () => true,
    getRecord: async () => ({ id: "r1", person_id: "p1", status: "ocr_processing" }),
    getAttachments: async () => [
      {
        id: "a1",
        storage_path: "a.png",
        mime_type: "image/png",
        original_filename: "a.png",
      },
    ],
    downloadAttachment: async () => new Blob(["image"]),
    updateRecordSuccess: async () => {},
    updateRecordFailure: async () => {},
  };
}

function createOpenRouterMock(): OpenRouterOcrClient {
  return {
    callVisionOcrSingle: async () => ({
      ocr_text: "text",
      suggested_title: "title",
      truncated: false,
    }),
  };
}

Deno.test("health-ocr handler responds to OPTIONS", async () => {
  const handler = createHealthOcrHandler({
    config: {
      openRouterApiKey: "key",
      supabaseUrl: "https://example.supabase.co",
      supabaseAnonKey: "anon",
      supabaseServiceRoleKey: "service-role-key",
    },
    createRepository: () => createRepositoryMock(),
    openRouterClient: createOpenRouterMock(),
    maxAttachmentBytes: 1024,
    maxOcrErrorLength: 500,
    defaultTitle: "Fallback",
  });

  const response = await handler(
    new Request("http://localhost/functions/v1/health-ocr", { method: "OPTIONS" }),
  );
  assertEquals(response.status, 200);
  assertEquals(
    response.headers.get("Access-Control-Allow-Origin"),
    corsHeaders["Access-Control-Allow-Origin"],
  );
});

Deno.test(
  "health-ocr handler returns env configuration error when OPENROUTER key is missing",
  async () => {
    const handler = createHealthOcrHandler({
      config: {
        openRouterApiKey: undefined,
        supabaseUrl: "https://example.supabase.co",
        supabaseAnonKey: "anon",
        supabaseServiceRoleKey: "service-role-key",
      },
      createRepository: () => createRepositoryMock(),
      openRouterClient: null,
      maxAttachmentBytes: 1024,
      maxOcrErrorLength: 500,
      defaultTitle: "Fallback",
    });

    const payload = await assertJsonResponse<{ success: boolean; error: string }>(
      await handler(
        new Request("http://localhost/functions/v1/health-ocr", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ record_id: "rec-1" }),
        }),
      ),
      400,
    );

    assertEquals(payload.success, false);
    if (!payload.error.includes("OPENROUTER_API_KEY")) {
      throw new Error(`Expected OPENROUTER_API_KEY error, got: ${payload.error}`);
    }
  },
);

Deno.test("health-ocr handler returns success payload for valid request", async () => {
  const handler = createHealthOcrHandler({
    config: {
      openRouterApiKey: "key",
      supabaseUrl: "https://example.supabase.co",
      supabaseAnonKey: "anon",
      supabaseServiceRoleKey: "service-role-key",
    },
    createRepository: () => createRepositoryMock(),
    openRouterClient: createOpenRouterMock(),
    maxAttachmentBytes: 1024,
    maxOcrErrorLength: 500,
    defaultTitle: "Fallback",
  });

  const payload = await assertJsonResponse<{
    success: boolean;
    ocr_text: string;
    suggested_title: string;
  }>(
    await handler(
      new Request("http://localhost/functions/v1/health-ocr", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer token",
        },
        body: JSON.stringify({ record_id: "rec-1" }),
      }),
    ),
    200,
  );

  assertEquals(payload.success, true);
  assertEquals(payload.suggested_title, "title");
});

Deno.test("health-ocr default handler fails when OPENROUTER key missing", async () => {
  await withEnv(
    {
      OPENROUTER_API_KEY: undefined,
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
    },
    async () => {
      const { handleRequest } = await import(`./handler.ts?missing-openrouter=${Date.now()}`);
      const payload = await assertJsonResponse<{ success: boolean; error: string }>(
        await handleRequest(
          new Request("http://localhost/functions/v1/health-ocr", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: "Bearer token",
            },
            body: JSON.stringify({ record_id: "rec-1" }),
          }),
        ),
        400,
      );
      assertEquals(payload.success, false);
    },
  );
});

Deno.test("health-ocr handler validates Supabase env and authorization header", async () => {
  const missingSupabaseHandler = createHealthOcrHandler({
    config: {
      openRouterApiKey: "key",
      supabaseUrl: undefined,
      supabaseAnonKey: "anon",
      supabaseServiceRoleKey: undefined,
    },
    createRepository: () => createRepositoryMock(),
    openRouterClient: createOpenRouterMock(),
    maxAttachmentBytes: 1024,
    maxOcrErrorLength: 500,
    defaultTitle: "Fallback",
  });

  const missingSupabase = await assertJsonResponse<{ success: boolean; error: string }>(
    await missingSupabaseHandler(
      new Request("http://localhost/functions/v1/health-ocr", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer token" },
        body: JSON.stringify({ record_id: "rec-1" }),
      }),
    ),
    400,
  );
  assertEquals(missingSupabase.success, false);
  if (!missingSupabase.error.includes("Supabase environment not configured")) {
    throw new Error(`Expected Supabase config error, got: ${missingSupabase.error}`);
  }

  const missingAuthHandler = createHealthOcrHandler({
    config: {
      openRouterApiKey: "key",
      supabaseUrl: "https://example.supabase.co",
      supabaseAnonKey: "anon",
      supabaseServiceRoleKey: "service-role-key",
    },
    createRepository: () => createRepositoryMock(),
    openRouterClient: createOpenRouterMock(),
    maxAttachmentBytes: 1024,
    maxOcrErrorLength: 500,
    defaultTitle: "Fallback",
  });

  const missingAuth = await assertJsonResponse<{ success: boolean; error: string }>(
    await missingAuthHandler(
      new Request("http://localhost/functions/v1/health-ocr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ record_id: "rec-1" }),
      }),
    ),
    400,
  );
  assertEquals(missingAuth.error, "Missing authorization header");
});

Deno.test("health-ocr handler handles malformed json and non-Error exceptions", async () => {
  const handler = createHealthOcrHandler({
    config: {
      openRouterApiKey: "key",
      supabaseUrl: "https://example.supabase.co",
      supabaseAnonKey: "anon",
      supabaseServiceRoleKey: "service-role-key",
    },
    createRepository: () => createRepositoryMock(),
    openRouterClient: createOpenRouterMock(),
    maxAttachmentBytes: 1024,
    maxOcrErrorLength: 500,
    defaultTitle: "Fallback",
  });

  const malformedBody = await assertJsonResponse<{ success: boolean; error: string }>(
    await handler(
      new Request("http://localhost/functions/v1/health-ocr", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer token",
        },
        body: "{bad-json",
      }),
    ),
    400,
  );
  assertEquals(malformedBody.success, false);
  assertEquals(malformedBody.error, "Missing required field: record_id");

  const nonErrorThrowHandler = createHealthOcrHandler({
    config: {
      openRouterApiKey: "key",
      supabaseUrl: "https://example.supabase.co",
      supabaseAnonKey: "anon",
      supabaseServiceRoleKey: "service-role-key",
    },
    createRepository: () => {
      throw "boom";
    },
    openRouterClient: createOpenRouterMock(),
    maxAttachmentBytes: 1024,
    maxOcrErrorLength: 500,
    defaultTitle: "Fallback",
  });

  const unknownError = await assertJsonResponse<{ success: boolean; error: string }>(
    await nonErrorThrowHandler(
      new Request("http://localhost/functions/v1/health-ocr", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer token",
        },
        body: JSON.stringify({ record_id: "rec-1" }),
      }),
    ),
    400,
  );
  assertEquals(unknownError.error, "Unknown error");
});
