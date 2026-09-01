// deno-lint-ignore-file require-await
import { assertEquals } from "std/assert/assert-equals";
import { emptyLlmUsage } from "../_shared/llm-usage.ts";
import { ClaimLostError } from "../_shared/processing-claim.ts";
import { runHealthOcrService } from "./service.ts";
import type { OpenRouterOcrClient } from "./openrouter-client.ts";
import type { HealthOcrRepository, OcrAttachment } from "./repository.ts";
import type { EdgeAttrs, EdgeSpanHandle, EdgeTelemetry } from "../_shared/observability.ts";

interface RepositoryState {
  updatedSuccess: Array<{ recordId: string; ocrText: string; title: string }>;
  updatedFailure: Array<{ recordId: string; errorMessage: string }>;
}

function createRepositoryMock(
  options: {
    attachments?: OcrAttachment[];
    blobsByPath?: Record<string, Blob | null>;
    userAllowed?: boolean;
    claimTaken?: boolean;
    claimLost?: boolean;
    authenticated?: boolean;
    recordExists?: boolean;
    updateFailureThrows?: boolean;
  } = {},
): { repository: HealthOcrRepository; state: RepositoryState } {
  const attachments = options.attachments ?? [
    {
      id: "att-1",
      storage_path: "a.png",
      mime_type: "image/png",
      original_filename: "a.png",
    },
  ];

  const blobsByPath = options.blobsByPath ?? {
    "a.png": new Blob(["image-a"]),
    "b.png": new Blob(["image-b"]),
  };

  const state: RepositoryState = {
    updatedSuccess: [],
    updatedFailure: [],
  };

  return {
    state,
    repository: {
      authenticateUser: async () =>
        options.authenticated === false ? null : { id: "user-1", email: "user@example.com" },
      isAllowedUser: async () => options.userAllowed !== false,
      getRecord: async () =>
        options.recordExists === false
          ? null
          : {
              id: "record-1",
              person_id: "person-1",
              status: "ocr_processing",
            },
      getAttachments: async () => attachments,
      downloadAttachment: async (storagePath: string) => blobsByPath[storagePath] ?? null,
      claimRecord: async () => (options.claimTaken === false ? null : "run-1"),
      renewClaim: async () => options.claimLost !== true,
      updateRecordSuccess: async (recordId, payload) => {
        state.updatedSuccess.push({
          recordId,
          ocrText: payload.ocrText,
          title: payload.title,
        });
      },
      updateRecordFailure: async (recordId, errorMessage) => {
        if (options.updateFailureThrows) {
          throw new Error("failed to mark ocr_failed");
        }
        state.updatedFailure.push({ recordId, errorMessage });
      },
    },
  };
}

function createOpenRouterMock(
  resolver: OpenRouterOcrClient["callVisionOcrSingle"],
): OpenRouterOcrClient {
  return {
    callVisionOcrSingle: resolver,
  };
}

function createTelemetryMock(): {
  telemetry: EdgeTelemetry;
  spans: Array<{
    name: string;
    startAttrs?: EdgeAttrs;
    endAttrs?: EdgeAttrs;
    status?: "ok" | "error";
    statusMessage?: string;
  }>;
} {
  const spans: Array<{
    name: string;
    startAttrs?: EdgeAttrs;
    endAttrs?: EdgeAttrs;
    status?: "ok" | "error";
    statusMessage?: string;
  }> = [];

  return {
    spans,
    telemetry: {
      context: {
        component: "health-ocr",
        traceId: "trace-id",
        requestId: "request-id",
        env: "test",
        release: "test",
      },
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
      startSpan: (name, options) => {
        const span: {
          name: string;
          startAttrs?: EdgeAttrs;
          endAttrs?: EdgeAttrs;
          status?: "ok" | "error";
          statusMessage?: string;
        } = {
          name,
          startAttrs: options?.attrs,
        };
        spans.push(span);
        return {
          traceId: "trace-id",
          spanId: "span-id",
          requestId: "request-id",
          traceparent: "00-traceid-spanid-01",
          log: () => {},
          end: async (endOptions) => {
            span.endAttrs = endOptions?.attrs;
            span.status = endOptions?.status;
            span.statusMessage = endOptions?.statusMessage;
          },
        } satisfies EdgeSpanHandle;
      },
    },
  };
}

Deno.test("runHealthOcrService succeeds with multi-page OCR and updates record", async () => {
  const { repository, state } = createRepositoryMock({
    attachments: [
      {
        id: "att-1",
        storage_path: "a.png",
        mime_type: "image/png",
        original_filename: "a.png",
      },
      {
        id: "att-2",
        storage_path: "b.png",
        mime_type: "image/png",
        original_filename: "b.png",
      },
    ],
  });

  let callIndex = 0;
  const openRouter = createOpenRouterMock(async () => {
    callIndex += 1;
    if (callIndex === 1) {
      return {
        ocr_text: "First page text",
        suggested_title: " Blood panel ",
        truncated: false,
        usage: emptyLlmUsage(),
      };
    }
    return {
      ocr_text: "Second page text",
      suggested_title: "ignored",
      truncated: false,
      usage: emptyLlmUsage(),
    };
  });

  const result = await runHealthOcrService(
    { authToken: "token", recordId: "record-1" },
    {
      repository,
      openRouterClient: openRouter,
      defaultTitle: "Fallback",
    },
  );

  assertEquals(result.status, 200);
  assertEquals(result.payload.success, true);
  assertEquals(state.updatedSuccess.length, 1);
  assertEquals(state.updatedSuccess[0].recordId, "record-1");
  assertEquals(state.updatedSuccess[0].title, "Blood panel");
  assertEquals(state.updatedFailure.length, 0);
});

Deno.test("runHealthOcrService returns error when no attachments exist", async () => {
  const { repository, state } = createRepositoryMock({ attachments: [] });
  const openRouter = createOpenRouterMock(async () => ({
    ocr_text: "unused",
    suggested_title: "unused",
    truncated: false,
    usage: emptyLlmUsage(),
  }));

  const result = await runHealthOcrService(
    { authToken: "token", recordId: "record-1" },
    {
      repository,
      openRouterClient: openRouter,
    },
  );

  assertEquals(result.status, 400);
  assertEquals(result.payload.success, false);
  assertEquals(result.payload.error, "No attachments found for this record");
  assertEquals(state.updatedFailure.length, 1);
});

Deno.test("runHealthOcrService marks failed when OCR extraction fails for every page", async () => {
  const { repository, state } = createRepositoryMock();
  const openRouter = createOpenRouterMock(async () => {
    throw new Error("OCR down");
  });

  const result = await runHealthOcrService(
    { authToken: "token", recordId: "record-1" },
    {
      repository,
      openRouterClient: openRouter,
      maxOcrErrorLength: 50,
    },
  );

  assertEquals(result.status, 400);
  assertEquals(result.payload.success, false);
  assertEquals(result.payload.error, "Failed to extract text from any attachment");
  assertEquals(state.updatedSuccess.length, 0);
  assertEquals(state.updatedFailure.length, 1);
});

Deno.test(
  "runHealthOcrService records page telemetry with mime type and OCR input kind",
  async () => {
    const { repository } = createRepositoryMock({
      attachments: [
        {
          id: "att-pdf",
          storage_path: "a.pdf",
          mime_type: "application/pdf",
          original_filename: "a.pdf",
        },
      ],
      blobsByPath: {
        "a.pdf": new Blob(["pdf"], { type: "application/pdf" }),
      },
    });
    const { telemetry, spans } = createTelemetryMock();
    const openRouter = createOpenRouterMock(async () => ({
      ocr_text: "usable text",
      suggested_title: "Title",
      truncated: false,
      usage: emptyLlmUsage(),
    }));

    const result = await runHealthOcrService(
      { authToken: "token", recordId: "record-1" },
      {
        repository,
        openRouterClient: openRouter,
        telemetry,
      },
    );

    assertEquals(result.status, 200);
    const pageSpan = spans.find((span) => span.name === "edge.health_ocr.page");
    assertEquals(pageSpan?.startAttrs?.attachment_mime_type, "application/pdf");
    assertEquals(pageSpan?.endAttrs?.ocr_input_type, "file");
  },
);

Deno.test(
  "runHealthOcrService skips oversized attachments and still succeeds when any page works",
  async () => {
    const { repository, state } = createRepositoryMock({
      attachments: [
        {
          id: "att-big",
          storage_path: "big.png",
          mime_type: "image/png",
          original_filename: "big.png",
        },
        {
          id: "att-ok",
          storage_path: "a.png",
          mime_type: "image/png",
          original_filename: "a.png",
        },
      ],
      blobsByPath: {
        "big.png": new Blob([new Uint8Array(20)], { type: "image/png" }),
        "a.png": new Blob(["small"], { type: "image/png" }),
      },
    });

    const openRouter = createOpenRouterMock(async () => ({
      ocr_text: "usable text",
      suggested_title: "Title",
      truncated: false,
      usage: emptyLlmUsage(),
    }));

    const result = await runHealthOcrService(
      { authToken: "token", recordId: "record-1" },
      {
        repository,
        openRouterClient: openRouter,
        maxAttachmentBytes: 10,
      },
    );

    assertEquals(result.status, 200);
    assertEquals(state.updatedSuccess.length, 1);
    assertEquals(state.updatedFailure.length, 0);
  },
);

Deno.test("runHealthOcrService returns auth and guard errors before marking failure", async () => {
  const unauthorized = createRepositoryMock({ authenticated: false });
  const openRouter = createOpenRouterMock(async () => ({
    ocr_text: "unused",
    suggested_title: "unused",
    truncated: false,
    usage: emptyLlmUsage(),
  }));

  const unauthorizedResult = await runHealthOcrService(
    { authToken: "token", recordId: "record-1" },
    {
      repository: unauthorized.repository,
      openRouterClient: openRouter,
    },
  );
  assertEquals(unauthorizedResult.status, 400);
  assertEquals(unauthorizedResult.payload.error, "Unauthorized - invalid token");
  assertEquals(unauthorized.state.updatedFailure.length, 0);

  const disallowed = createRepositoryMock({ userAllowed: false });
  const disallowedResult = await runHealthOcrService(
    { authToken: "token", recordId: "record-1" },
    {
      repository: disallowed.repository,
      openRouterClient: openRouter,
    },
  );
  assertEquals(disallowedResult.payload.error, "User not in allowlist");
  assertEquals(disallowed.state.updatedFailure.length, 0);

  const missingRecordId = createRepositoryMock();
  const missingRecordIdResult = await runHealthOcrService(
    { authToken: "token", recordId: null },
    {
      repository: missingRecordId.repository,
      openRouterClient: openRouter,
    },
  );
  assertEquals(missingRecordIdResult.payload.error, "Missing required field: record_id");
  assertEquals(missingRecordId.state.updatedFailure.length, 0);
});

Deno.test("runHealthOcrService handles missing record and updateRecordFailure errors", async () => {
  const missingRecord = createRepositoryMock({ recordExists: false });
  const openRouter = createOpenRouterMock(async () => ({
    ocr_text: "unused",
    suggested_title: "unused",
    truncated: false,
    usage: emptyLlmUsage(),
  }));

  const missingRecordResult = await runHealthOcrService(
    { authToken: "token", recordId: "record-1" },
    {
      repository: missingRecord.repository,
      openRouterClient: openRouter,
    },
  );
  assertEquals(missingRecordResult.payload.error, "Record not found or access denied");
  assertEquals(missingRecord.state.updatedFailure.length, 1);

  const failedMarking = createRepositoryMock({
    updateFailureThrows: true,
    attachments: [
      {
        id: "att-1",
        storage_path: "missing.png",
        mime_type: "image/png",
        original_filename: "missing.png",
      },
    ],
    blobsByPath: {
      "missing.png": null,
    },
  });
  const result = await runHealthOcrService(
    { authToken: "token", recordId: "record-1" },
    {
      repository: failedMarking.repository,
      openRouterClient: openRouter,
    },
  );
  assertEquals(result.status, 400);
  assertEquals(result.payload.error, "Failed to extract text from any attachment");
});

Deno.test(
  "runHealthOcrService puts each page's cost on its span and the record's total on the service span",
  async () => {
    const { repository } = createRepositoryMock({
      attachments: [
        { id: "a1", storage_path: "a.png", mime_type: "image/png", original_filename: "a.png" },
        { id: "a2", storage_path: "b.png", mime_type: "image/png", original_filename: "b.png" },
      ],
    });
    const { telemetry, spans } = createTelemetryMock();
    let page = 0;
    const openRouter = createOpenRouterMock(async () => {
      page += 1;
      return {
        ocr_text: `page ${page}`,
        suggested_title: "t",
        truncated: false,
        usage: { promptTokens: 1000 * page, completionTokens: 100 * page, costUsd: null },
      };
    });

    const result = await runHealthOcrService(
      { authToken: "token", recordId: "record-1" },
      { repository, openRouterClient: openRouter, telemetry },
    );

    assertEquals(result.status, 200);
    const pageSpans = spans.filter((span) => span.name === "edge.health_ocr.page");
    assertEquals(pageSpans[0]?.endAttrs?.llm_prompt_tokens, 1000);
    assertEquals(pageSpans[1]?.endAttrs?.llm_prompt_tokens, 2000);
    const serviceSpan = spans.find((span) => span.name === "edge.health_ocr.service");
    // The record's whole OCR cost, summed across pages; the unreported cost stays absent.
    assertEquals(serviceSpan?.endAttrs?.llm_prompt_tokens, 3000);
    assertEquals(serviceSpan?.endAttrs?.llm_completion_tokens, 300);
    assertEquals("llm_cost_usd" in (serviceSpan?.endAttrs ?? {}), false);
  },
);

Deno.test("runHealthOcrService refuses a record another run already owns", async () => {
  const { repository, state } = createRepositoryMock({ claimTaken: false });
  const openRouter = createOpenRouterMock(async () => {
    throw new Error("the OCR provider must not be called for a record we do not own");
  });

  const result = await runHealthOcrService(
    { authToken: "token", recordId: "record-1" },
    { repository, openRouterClient: openRouter },
  );

  assertEquals(result.status, 409);
  // Not marked failed: the run that owns the record is still working on it.
  assertEquals(state.updatedFailure.length, 0);
  assertEquals(state.updatedSuccess.length, 0);
});

Deno.test("runHealthOcrService writes its result under the claim it took", async () => {
  const { repository } = createRepositoryMock();
  const runIds: Array<string | undefined> = [];
  const openRouter = createOpenRouterMock(async () => ({
    ocr_text: "page",
    suggested_title: "t",
    truncated: false,
    usage: emptyLlmUsage(),
  }));

  const result = await runHealthOcrService(
    { authToken: "token", recordId: "record-1" },
    {
      repository: {
        ...repository,
        updateRecordSuccess: async (recordId, payload, options) => {
          runIds.push(options?.runId);
          await repository.updateRecordSuccess(recordId, payload, options);
        },
      },
      openRouterClient: openRouter,
    },
  );

  assertEquals(result.status, 200);
  assertEquals(runIds, ["run-1"]);
});

Deno.test("runHealthOcrService discards its result when the claim was taken away", async () => {
  const { repository, state } = createRepositoryMock();
  const openRouter = createOpenRouterMock(async () => ({
    ocr_text: "page",
    suggested_title: "t",
    truncated: false,
    usage: emptyLlmUsage(),
  }));

  const result = await runHealthOcrService(
    { authToken: "token", recordId: "record-1" },
    {
      repository: {
        ...repository,
        // What a lost claim looks like from the worker's side: the conditional update matched
        // nothing because another run owns the record now.
        updateRecordSuccess: async () => {
          throw new ClaimLostError("record-1");
        },
      },
      openRouterClient: openRouter,
      log: { log: () => {}, error: () => {} },
    },
  );

  assertEquals(result.status, 400);
  // The transcription is dropped rather than written over whatever replaced this run.
  assertEquals(state.updatedSuccess.length, 0);
});

Deno.test("runHealthOcrService stops when its claim is taken mid-document", async () => {
  const { repository, state } = createRepositoryMock({
    claimLost: true,
    attachments: [
      { id: "a1", storage_path: "a.png", mime_type: "image/png", original_filename: "a.png" },
      { id: "a2", storage_path: "b.png", mime_type: "image/png", original_filename: "b.png" },
    ],
  });
  let pages = 0;
  const openRouter = createOpenRouterMock(async () => {
    pages += 1;
    return {
      ocr_text: "page",
      suggested_title: "t",
      truncated: false,
      usage: emptyLlmUsage(),
    };
  });

  const result = await runHealthOcrService(
    { authToken: "token", recordId: "record-1" },
    {
      repository,
      openRouterClient: openRouter,
      // One at a time, so "it stopped" is visible: with pages in flight together, the second
      // would already have been sent before the first renewal came back.
      pageConcurrency: 1,
      log: { log: () => {}, error: () => {} },
    },
  );

  assertEquals(result.status, 400);
  // It stops paying the provider the moment the record stops being its to write to.
  assertEquals(pages, 1);
  assertEquals(state.updatedSuccess.length, 0);
});

Deno.test("runHealthOcrService transcribes pages in parallel and keeps their order", async () => {
  const { repository, state } = createRepositoryMock({
    attachments: ["a", "b", "c", "d"].map((name) => ({
      id: name,
      storage_path: `${name}.png`,
      mime_type: "image/png",
      original_filename: `${name}.png`,
    })),
    blobsByPath: {
      "a.png": new Blob(["a"]),
      "b.png": new Blob(["b"]),
      "c.png": new Blob(["c"]),
      "d.png": new Blob(["d"]),
    },
  });

  let inFlight = 0;
  let peakInFlight = 0;
  let started = 0;
  const openRouter = createOpenRouterMock(async () => {
    const index = started++;
    inFlight += 1;
    peakInFlight = Math.max(peakInFlight, inFlight);
    // The first page is the slowest, so a result appended on completion would come back last.
    await new Promise((resolve) => setTimeout(resolve, index === 0 ? 20 : 1));
    inFlight -= 1;
    return {
      ocr_text: `page ${index}`,
      suggested_title: "t",
      truncated: false,
      usage: emptyLlmUsage(),
    };
  });

  const result = await runHealthOcrService(
    { authToken: "token", recordId: "record-1" },
    {
      repository,
      openRouterClient: openRouter,
      pageConcurrency: 2,
      log: { log: () => {}, error: () => {} },
    },
  );

  assertEquals(result.status, 200);
  assertEquals(peakInFlight, 2);
  // Bounded, not unbounded: four pages fired at once is a rate-limit response and four images
  // held in memory together.
  assertEquals(started, 4);

  // Page order is the document's order, whatever order the provider answered in.
  const text = state.updatedSuccess[0].ocrText;
  assertEquals(text.indexOf("page 0") < text.indexOf("page 1"), true, text);
  assertEquals(text.indexOf("Страница 1") < text.indexOf("Страница 4"), true, text);
});

Deno.test(
  "runHealthOcrService sends the normalised page, and the original when it cannot be",
  async () => {
    const { repository } = createRepositoryMock({
      attachments: [
        { id: "a1", storage_path: "a.png", mime_type: "image/png", original_filename: "a.png" },
        {
          id: "a2",
          storage_path: "b.pdf",
          mime_type: "application/pdf",
          original_filename: "b.pdf",
        },
      ],
      blobsByPath: {
        "a.png": new Blob(["a-original-bytes"]),
        "b.pdf": new Blob(["pdf-bytes"]),
      },
    });

    const sent: Array<{ mimeType: string; url: string }> = [];
    const openRouter = createOpenRouterMock(async (payload) => {
      sent.push({ mimeType: payload.mimeType, url: payload.url });
      return {
        ocr_text: "page",
        suggested_title: "t",
        truncated: false,
        usage: emptyLlmUsage(),
      };
    });

    await runHealthOcrService(
      { authToken: "token", recordId: "record-1" },
      {
        repository,
        openRouterClient: openRouter,
        pageConcurrency: 1,
        preprocessImage: async (_bytes, mimeType) =>
          mimeType === "image/png"
            ? {
                bytes: new TextEncoder().encode("normalised"),
                mimeType: "image/jpeg",
                width: 100,
                height: 100,
              }
            : null,
        log: { log: () => {}, error: () => {} },
      },
    );

    assertEquals(sent.length, 2);
    // The normalised page replaces the stored one, type included.
    assertEquals(sent[0].mimeType, "image/jpeg");
    assertEquals(sent[0].url, `data:image/jpeg;base64,${btoa("normalised")}`);
    // A page that could not be normalised is still sent, exactly as it was stored.
    assertEquals(sent[1].mimeType, "application/pdf");
    assertEquals(sent[1].url, `data:application/pdf;base64,${btoa("pdf-bytes")}`);
  },
);

// A compressed size says nothing about pixel dimensions: three ordinary phone photographs, or
// one decompression bomb, are far more RGBA at once than the function has.
Deno.test("pages are decoded one at a time even while three are in flight", async () => {
  const { repository } = createRepositoryMock({
    attachments: ["a", "b", "c"].map((name) => ({
      id: name,
      storage_path: `${name}.png`,
      mime_type: "image/png",
      original_filename: `${name}.png`,
    })),
    blobsByPath: {
      "a.png": new Blob(["a"]),
      "b.png": new Blob(["b"]),
      "c.png": new Blob(["c"]),
    },
  });

  let decodingNow = 0;
  let peakDecoding = 0;
  let callsInFlight = 0;
  let peakCallsInFlight = 0;

  await runHealthOcrService(
    { authToken: "token", recordId: "record-1" },
    {
      repository,
      pageConcurrency: 3,
      preprocessImage: async () => {
        decodingNow += 1;
        peakDecoding = Math.max(peakDecoding, decodingNow);
        await new Promise((resolve) => setTimeout(resolve, 5));
        decodingNow -= 1;
        return {
          bytes: new TextEncoder().encode("small"),
          mimeType: "image/jpeg",
          width: 10,
          height: 10,
        };
      },
      openRouterClient: createOpenRouterMock(async () => {
        callsInFlight += 1;
        peakCallsInFlight = Math.max(peakCallsInFlight, callsInFlight);
        await new Promise((resolve) => setTimeout(resolve, 10));
        callsInFlight -= 1;
        return {
          ocr_text: "page",
          suggested_title: "t",
          truncated: false,
          usage: emptyLlmUsage(),
        };
      }),
      log: { log: () => {}, error: () => {} },
    },
  );

  // Memory is the ceiling for decoding; the provider is the ceiling for the calls.
  assertEquals(peakDecoding, 1);
  assertEquals(peakCallsInFlight > 1, true, `expected overlapping calls, saw ${peakCallsInFlight}`);
});
