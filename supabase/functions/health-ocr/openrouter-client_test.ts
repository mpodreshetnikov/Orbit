// deno-lint-ignore-file require-await
import { assertEquals } from "std/assert/assert-equals";
import { createOpenRouterOcrClient } from "./openrouter-client.ts";

interface OpenRouterRequestBody {
  messages: Array<{ content: Array<Record<string, unknown>> }>;
}

async function assertThrowsWithMessage(
  run: () => Promise<unknown>,
  expectedSnippet: string,
): Promise<void> {
  let caught: unknown = null;
  try {
    await run();
  } catch (error) {
    caught = error;
  }

  if (!(caught instanceof Error)) {
    throw new Error("Expected an error to be thrown");
  }
  if (!caught.message.includes(expectedSnippet)) {
    throw new Error(`Expected "${caught.message}" to include "${expectedSnippet}"`);
  }
}

Deno.test("createOpenRouterOcrClient parses OCR JSON payload", async () => {
  const client = createOpenRouterOcrClient({
    fetchFn: async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({ ocr_text: "hello", suggested_title: "Lab Report" }),
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    apiKey: "key",
    referer: "https://example.com",
  });

  const result = await client.callVisionOcrSingle(
    { url: "data:image/png;base64,AAA", mimeType: "image/png" },
    { requestTitle: true },
  );

  assertEquals(result.ocr_text, "hello");
  assertEquals(result.suggested_title, "Lab Report");
});

Deno.test("createOpenRouterOcrClient sends images as image_url content", async () => {
  let requestBody: OpenRouterRequestBody | null = null;
  const client = createOpenRouterOcrClient({
    fetchFn: async (_input, init) => {
      requestBody = JSON.parse(
        String((init as { body?: BodyInit | null } | undefined)?.body ?? ""),
      ) as OpenRouterRequestBody;
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({ ocr_text: "hello", suggested_title: "Lab Report" }),
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    },
    apiKey: "key",
    referer: "https://example.com",
  });

  await client.callVisionOcrSingle(
    { url: "data:image/png;base64,AAA", mimeType: "image/png" },
    { requestTitle: true },
  );

  if (!requestBody) {
    throw new Error("Expected request body to be captured");
  }
  const messages = (requestBody as OpenRouterRequestBody).messages;
  assertEquals(messages[1].content[1].type, "image_url");
  assertEquals(
    (messages[1].content[1].image_url as { url: string }).url,
    "data:image/png;base64,AAA",
  );
});

Deno.test("createOpenRouterOcrClient sends PDFs as file content", async () => {
  let requestBody: OpenRouterRequestBody | null = null;
  const client = createOpenRouterOcrClient({
    fetchFn: async (_input, init) => {
      requestBody = JSON.parse(
        String((init as { body?: BodyInit | null } | undefined)?.body ?? ""),
      ) as OpenRouterRequestBody;
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({ ocr_text: "hello", suggested_title: "Lab Report" }),
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    },
    apiKey: "key",
    referer: "https://example.com",
  });

  await client.callVisionOcrSingle(
    { url: "data:application/pdf;base64,AAA", mimeType: "application/pdf" },
    { requestTitle: false },
  );

  if (!requestBody) {
    throw new Error("Expected request body to be captured");
  }
  const messages = (requestBody as OpenRouterRequestBody).messages;
  assertEquals(messages[1].content[1].type, "file");
  assertEquals(messages[1].content[1].file as { filename: string; file_data: string }, {
    filename: "document.pdf",
    file_data: "data:application/pdf;base64,AAA",
  });
});

Deno.test("createOpenRouterOcrClient rejects unsupported MIME types", async () => {
  const client = createOpenRouterOcrClient({
    fetchFn: async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({ ocr_text: "hello", suggested_title: "Lab Report" }),
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    apiKey: "key",
    referer: "https://example.com",
  });

  await assertThrowsWithMessage(
    () =>
      client.callVisionOcrSingle(
        { url: "data:text/plain;base64,AAA", mimeType: "text/plain" },
        { requestTitle: false },
      ),
    "Unsupported OCR attachment MIME type",
  );
});

Deno.test("createOpenRouterOcrClient throws API errors", async () => {
  const client = createOpenRouterOcrClient({
    fetchFn: async () => new Response("bad request", { status: 400 }),
    apiKey: "key",
    referer: "https://example.com",
  });

  await assertThrowsWithMessage(
    () =>
      client.callVisionOcrSingle(
        { url: "data:image/png;base64,AAA", mimeType: "image/png" },
        { requestTitle: false },
      ),
    "OpenRouter API error",
  );
});

Deno.test("createOpenRouterOcrClient maps aborts to timeout message", async () => {
  const client = createOpenRouterOcrClient({
    fetchFn: (_input, init) =>
      new Promise((_resolve, reject) => {
        const signal = (init as { signal?: AbortSignal } | undefined)?.signal;
        signal?.addEventListener("abort", () => {
          const error = new Error("aborted");
          (error as { name?: string }).name = "AbortError";
          reject(error);
        });
      }),
    apiKey: "key",
    referer: "https://example.com",
    timeoutMs: 1,
  });

  await assertThrowsWithMessage(
    () =>
      client.callVisionOcrSingle(
        { url: "data:image/png;base64,AAA", mimeType: "image/png" },
        { requestTitle: false },
      ),
    "timed out",
  );
});

Deno.test(
  "createOpenRouterOcrClient handles empty content and title fallback branches",
  async () => {
    const noContentClient = createOpenRouterOcrClient({
      fetchFn: async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "" } }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      apiKey: "key",
      referer: "https://example.com",
    });

    await assertThrowsWithMessage(
      () =>
        noContentClient.callVisionOcrSingle(
          { url: "data:image/png;base64,AAA", mimeType: "image/png" },
          { requestTitle: true },
        ),
      "No response from OpenRouter",
    );

    const fallbackTitleClient = createOpenRouterOcrClient({
      fetchFn: async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({ ocr_text: undefined, suggested_title: "   " }),
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      apiKey: "key",
      referer: "https://example.com",
    });

    const fallbackResult = await fallbackTitleClient.callVisionOcrSingle(
      { url: "data:image/png;base64,AAA", mimeType: "image/png" },
      { requestTitle: false },
    );
    assertEquals(fallbackResult.ocr_text, "");
    assertEquals(fallbackResult.suggested_title.length > 0, true);
  },
);

function okResponse(payload: unknown, finishReason = "stop"): Response {
  return new Response(
    JSON.stringify({
      choices: [{ finish_reason: finishReason, message: { content: JSON.stringify(payload) } }],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

const NO_WAIT = { sleepFn: async () => {}, jitterFn: () => 0 };

Deno.test(
  "OCR request constrains the answer with a strict schema and pinned provider",
  async () => {
    let body: Record<string, unknown> = {};
    const client = createOpenRouterOcrClient({
      fetchFn: async (_input, init) => {
        body = JSON.parse(String((init as RequestInit).body));
        return okResponse({ ocr_text: "x", suggested_title: "t" });
      },
      apiKey: "key",
      referer: "https://example.com",
    });

    await client.callVisionOcrSingle(
      { url: "data:image/png;base64,AAA", mimeType: "image/png" },
      { requestTitle: true },
    );

    const responseFormat = body.response_format as {
      type: string;
      json_schema: { strict: boolean };
    };
    assertEquals(responseFormat.type, "json_schema");
    assertEquals(responseFormat.json_schema.strict, true);
    assertEquals((body.provider as { require_parameters: boolean }).require_parameters, true);
    // Transcription is not a task with a creative dimension.
    assertEquals(body.temperature, 0);
  },
);

Deno.test("OCR prompt forbids the rewriting that would corrupt lab values", async () => {
  let prompt = "";
  const client = createOpenRouterOcrClient({
    fetchFn: async (_input, init) => {
      const body = JSON.parse(String((init as RequestInit).body)) as {
        messages: Array<{ content: unknown }>;
      };
      prompt = body.messages
        .map((m) => (typeof m.content === "string" ? m.content : ""))
        .join("\n")
        .toLowerCase();
      return okResponse({ ocr_text: "x", suggested_title: "t" });
    },
    apiKey: "key",
    referer: "https://example.com",
  });

  await client.callVisionOcrSingle(
    { url: "data:image/png;base64,AAA", mimeType: "image/png" },
    { requestTitle: false },
  );

  // The model must not "help" — a corrected unit or a completed range is a changed lab result.
  assertEquals(prompt.includes("do not translate"), true);
  assertEquals(prompt.includes("exactly as printed"), true);
  // Guessing at illegible text is the failure mode that puts invented numbers into the chart.
  assertEquals(prompt.includes("[нрзб]"), true);
});

Deno.test("a transient 429 does not cost the page", async () => {
  let calls = 0;
  const client = createOpenRouterOcrClient({
    fetchFn: async () => {
      calls += 1;
      if (calls === 1) return new Response("rate limited", { status: 429 });
      return okResponse({ ocr_text: "recovered", suggested_title: "t" });
    },
    apiKey: "key",
    referer: "https://example.com",
    ...NO_WAIT,
  });

  const result = await client.callVisionOcrSingle(
    { url: "data:image/png;base64,AAA", mimeType: "image/png" },
    { requestTitle: false },
  );
  assertEquals(result.ocr_text, "recovered");
  assertEquals(calls, 2);
});

Deno.test("an authentication failure is not retried", async () => {
  let calls = 0;
  const client = createOpenRouterOcrClient({
    fetchFn: async () => {
      calls += 1;
      return new Response("unauthorized", { status: 401 });
    },
    apiKey: "key",
    referer: "https://example.com",
    ...NO_WAIT,
  });

  await assertThrowsWithMessage(
    () =>
      client.callVisionOcrSingle(
        { url: "data:image/png;base64,AAA", mimeType: "image/png" },
        { requestTitle: false },
      ),
    "OpenRouter API error: 401",
  );
  assertEquals(calls, 1);
});

Deno.test("the provider's error body never reaches the error message", async () => {
  // It can quote the request back, and for OCR the request carries the document image.
  const client = createOpenRouterOcrClient({
    fetchFn: async () =>
      new Response("invalid image data:image/png;base64,SECRETPATIENTIMAGE", { status: 400 }),
    apiKey: "key",
    referer: "https://example.com",
    ...NO_WAIT,
  });

  let message = "";
  try {
    await client.callVisionOcrSingle(
      { url: "data:image/png;base64,AAA", mimeType: "image/png" },
      { requestTitle: false },
    );
  } catch (error) {
    message = (error as Error).message;
  }
  assertEquals(message.includes("SECRETPATIENTIMAGE"), false);
  assertEquals(message.includes("400"), true);
});

Deno.test("a truncated page is retried with a larger completion budget", async () => {
  const budgets: number[] = [];
  let calls = 0;
  const client = createOpenRouterOcrClient({
    fetchFn: async (_input, init) => {
      const body = JSON.parse(String((init as RequestInit).body)) as { max_tokens: number };
      budgets.push(body.max_tokens);
      calls += 1;
      if (calls === 1)
        return okResponse({ ocr_text: "half a page", suggested_title: "t" }, "length");
      return okResponse({ ocr_text: "the whole page", suggested_title: "t" });
    },
    apiKey: "key",
    referer: "https://example.com",
    maxTokens: 1000,
    ...NO_WAIT,
  });

  const result = await client.callVisionOcrSingle(
    { url: "data:image/png;base64,AAA", mimeType: "image/png" },
    { requestTitle: false },
  );

  // Retrying the identical request would truncate at the identical point.
  assertEquals(budgets, [1000, 2000]);
  assertEquals(result.ocr_text, "the whole page");
  assertEquals(result.truncated, false);
});

Deno.test(
  "a page that never fits returns its partial text, flagged, instead of nothing",
  async () => {
    const client = createOpenRouterOcrClient({
      fetchFn: async (_input, init) => {
        const body = JSON.parse(String((init as RequestInit).body)) as { max_tokens: number };
        // Longer each time, so the assertion below also pins that the longest attempt wins.
        return okResponse(
          { ocr_text: "a".repeat(body.max_tokens), suggested_title: "t" },
          "length",
        );
      },
      apiKey: "key",
      referer: "https://example.com",
      maxTokens: 10,
      ...NO_WAIT,
    });

    const result = await client.callVisionOcrSingle(
      { url: "data:image/png;base64,AAA", mimeType: "image/png" },
      { requestTitle: false },
    );

    // The caller substitutes "" for a thrown error, losing the page whole; partial text is better.
    assertEquals(result.truncated, true);
    assertEquals(result.ocr_text.length, 40);
  },
);

Deno.test("JSON wrapped in a code fence is still read", async () => {
  const client = createOpenRouterOcrClient({
    fetchFn: async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: '```json\n{"ocr_text":"fenced","suggested_title":"T"}\n```',
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    apiKey: "key",
    referer: "https://example.com",
    ...NO_WAIT,
  });

  const result = await client.callVisionOcrSingle(
    { url: "data:image/png;base64,AAA", mimeType: "image/png" },
    { requestTitle: true },
  );
  assertEquals(result.ocr_text, "fenced");
});

Deno.test("content delivered as typed parts is not read as an empty page", async () => {
  const client = createOpenRouterOcrClient({
    fetchFn: async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: [{ type: "text", text: '{"ocr_text":"parts","suggested_title":"T"}' }],
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    apiKey: "key",
    referer: "https://example.com",
    ...NO_WAIT,
  });

  const result = await client.callVisionOcrSingle(
    { url: "data:image/png;base64,AAA", mimeType: "image/png" },
    { requestTitle: true },
  );
  assertEquals(result.ocr_text, "parts");
});
