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
