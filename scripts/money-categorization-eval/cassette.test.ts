import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cassetteKey, createCassetteFetch, stripReasoning } from "./cassette";

const dirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "money-cassette-"));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  // Temp dirs are under /tmp; leave cleanup to the OS between runs.
});

const REQUEST = {
  model: "test-model",
  messages: [{ role: "user", content: "Classify the line item." }],
};

describe("cassetteKey", () => {
  it("is stable for the same model and messages", () => {
    expect(cassetteKey(REQUEST)).toBe(cassetteKey({ ...REQUEST }));
  });

  it("changes when the prompt changes", () => {
    const other = { ...REQUEST, messages: [{ role: "user", content: "different" }] };
    expect(cassetteKey(other)).not.toBe(cassetteKey(REQUEST));
  });
});

describe("stripReasoning", () => {
  it("drops reasoning fields from choices", () => {
    const stripped = stripReasoning({
      choices: [
        {
          message: {
            role: "assistant",
            content: "{}",
            reasoning: "secret",
            reasoning_details: [{ data: "x" }],
          },
        },
      ],
    }) as { choices: Array<{ message: Record<string, unknown> }> };
    expect(stripped.choices[0].message.content).toBe("{}");
    expect(stripped.choices[0].message.reasoning).toBeUndefined();
    expect(stripped.choices[0].message.reasoning_details).toBeUndefined();
  });
});

describe("createCassetteFetch replay", () => {
  it("replays a committed response and misses when the prompt drifts", async () => {
    const dir = await tempDir();
    const key = cassetteKey(REQUEST);
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, `categorize-${key}.json`),
      JSON.stringify({
        request_hash: key,
        stage: "categorize",
        model: "test-model",
        response: { ok: true, choices: [{ message: { content: '{"items":[]}' } }] },
      }),
      "utf8",
    );

    const hit = await createCassetteFetch({ dir, mode: "replay" });
    const response = await hit.fetchFn("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify(REQUEST),
    });
    expect(response.ok).toBe(true);

    const miss = await createCassetteFetch({ dir, mode: "replay" });
    await expect(
      miss.fetchFn("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        body: JSON.stringify({
          ...REQUEST,
          messages: [{ role: "user", content: "drifted" }],
        }),
      }),
    ).rejects.toThrow(/cassette miss/);
  });
});
