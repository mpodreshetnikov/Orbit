// deno-lint-ignore-file require-await
import { assertEquals } from "std/assert/assert-equals";
import { emptyLlmUsage } from "../_shared/llm-usage.ts";
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
    claimRecord: async () => "run-1",
    renewClaim: async () => true,
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
      usage: emptyLlmUsage(),
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

// The request no longer carries the transcription: it says the record was claimed and the work
// is running. This is the whole point of the milestone -- a five-page document used to be
// transcribed inside a connection the browser abandoned at two minutes.
Deno.test(
  "health-ocr handler accepts the request without waiting for the transcription",
  async () => {
    const background: Array<Promise<unknown>> = [];
    const repository = createRepositoryMock();
    const persisted: string[] = [];
    repository.updateRecordSuccess = async (recordId) => {
      persisted.push(recordId);
    };

    const handler = createHealthOcrHandler({
      config: {
        openRouterApiKey: "key",
        supabaseUrl: "https://example.supabase.co",
        supabaseAnonKey: "anon",
        supabaseServiceRoleKey: "service-role-key",
      },
      createRepository: () => repository,
      openRouterClient: createOpenRouterMock(),
      maxAttachmentBytes: 1024,
      maxOcrErrorLength: 500,
      defaultTitle: "Fallback",
      runInBackground: (work) => {
        background.push(work);
      },
    });

    const payload = await assertJsonResponse<{
      success: boolean;
      accepted: boolean;
      record_id: string;
      ocr_text?: string;
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
      202,
    );

    assertEquals(payload.success, true);
    assertEquals(payload.accepted, true);
    assertEquals(payload.record_id, "rec-1");
    assertEquals(payload.ocr_text, undefined);
    assertEquals(background.length, 1);

    // And the work the response stood for really does run and persist.
    await background[0];
    assertEquals(persisted, ["rec-1"]);
  },
);

// A caller that loses the race gets an answer inside the request, because there is nothing to
// run: the 409 is decided before any work is handed to the background.
Deno.test("health-ocr handler reports a claimed record without starting work", async () => {
  const background: Array<Promise<unknown>> = [];
  const repository = createRepositoryMock();
  repository.claimRecord = async () => null;

  const handler = createHealthOcrHandler({
    config: {
      openRouterApiKey: "key",
      supabaseUrl: "https://example.supabase.co",
      supabaseAnonKey: "anon",
      supabaseServiceRoleKey: "service-role-key",
    },
    createRepository: () => repository,
    openRouterClient: createOpenRouterMock(),
    maxAttachmentBytes: 1024,
    maxOcrErrorLength: 500,
    defaultTitle: "Fallback",
    runInBackground: (work) => {
      background.push(work);
    },
  });

  const payload = await assertJsonResponse<{ success: boolean; error: string }>(
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
    409,
  );

  assertEquals(payload.success, false);
  assertEquals(background.length, 0);
});

// A transcription that fails after the response has gone out must not take the worker with it:
// the record already carries the failure, and an unhandled rejection would end the isolate.
Deno.test("health-ocr handler swallows a background failure", async () => {
  const repository = createRepositoryMock();
  repository.getAttachments = async () => {
    throw new Error("attachments unavailable");
  };
  const failures: string[] = [];
  repository.updateRecordFailure = async (_recordId, errorMessage) => {
    failures.push(errorMessage);
  };

  const handler = createHealthOcrHandler({
    config: {
      openRouterApiKey: "key",
      supabaseUrl: "https://example.supabase.co",
      supabaseAnonKey: "anon",
      supabaseServiceRoleKey: "service-role-key",
    },
    createRepository: () => repository,
    openRouterClient: createOpenRouterMock(),
    maxAttachmentBytes: 1024,
    maxOcrErrorLength: 500,
    defaultTitle: "Fallback",
    log: { log: () => {}, error: () => {} },
  });

  const payload = await assertJsonResponse<{ accepted: boolean }>(
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
    202,
  );

  assertEquals(payload.accepted, true);
  // The default dispatcher owns the promise; nothing is left for the runtime to report.
  await new Promise((resolve) => setTimeout(resolve, 0));
  // Classified before it is stored, like every other durable failure.
  assertEquals(failures, [
    "ocr_cause:internal the transcription failed for an unexpected reason: attachments unavailable",
  ]);
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
  assertEquals(
    malformedBody.error,
    "ocr_cause:internal the transcription failed for an unexpected reason: " +
      "Missing required field: record_id",
  );

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
