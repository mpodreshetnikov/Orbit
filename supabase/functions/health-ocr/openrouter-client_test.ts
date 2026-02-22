// deno-lint-ignore-file require-await
import { assertEquals } from "std/assert/assert-equals";
import { createOpenRouterOcrClient } from "./openrouter-client.ts";

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
