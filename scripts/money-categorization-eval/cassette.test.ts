import { access, mkdtemp, readdir, readFile, rm, writeFile, mkdir } from "node:fs/promises";
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
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const REQUEST = {
  model: "test-model",
  messages: [{ role: "user", content: "Classify the line item." }],
};

function post(body: unknown): RequestInit {
  return { method: "POST", body: JSON.stringify(body) };
}

function liveFetchReturning(payload: unknown, status = 200): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(payload), { status })) as unknown as typeof fetch;
}

describe("cassetteKey", () => {
  it("is stable for the same model and messages", () => {
    expect(cassetteKey(REQUEST)).toBe(cassetteKey({ ...REQUEST }));
  });

  it("changes when the prompt changes", () => {
    const other = { ...REQUEST, messages: [{ role: "user", content: "different" }] };
    expect(cassetteKey(other)).not.toBe(cassetteKey(REQUEST));
  });

  it("returns a 16-character hex digest, not the full hash", () => {
    const key = cassetteKey(REQUEST);
    expect(key).toHaveLength(16);
    expect(key).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("stripReasoning", () => {
  const withReasoning = {
    choices: [
      {
        finish_reason: "stop",
        message: {
          role: "assistant",
          content: "{}",
          reasoning: "first I considered…",
          reasoning_details: [{ type: "reasoning.encrypted", data: "gAAAAAB…" }],
        },
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 2 },
  };

  it("drops the reasoning trace", () => {
    const stripped = stripReasoning(withReasoning) as typeof withReasoning;
    expect(stripped.choices[0].message).not.toHaveProperty("reasoning");
    expect(stripped.choices[0].message).not.toHaveProperty("reasoning_details");
    expect(stripped.choices[0].message.content).toBe("{}");
    expect(stripped.choices[0].finish_reason).toBe("stop");
  });

  it("returns null and non-objects unchanged", () => {
    expect(stripReasoning(null)).toBeNull();
    expect(stripReasoning(undefined)).toBeUndefined();
    expect(stripReasoning("plain")).toBe("plain");
    expect(stripReasoning(42)).toBe(42);
  });

  it("passes through a payload with no choices rather than reshaping it", () => {
    const error = { error: { message: "nope", code: 400 } };
    expect(stripReasoning(error)).toEqual(error);
  });

  it("leaves non-object choices and messages alone", () => {
    expect(stripReasoning({ choices: ["raw"] })).toEqual({ choices: ["raw"] });
    expect(stripReasoning({ choices: [{ finish_reason: "stop" }] })).toEqual({
      choices: [{ finish_reason: "stop" }],
    });
    expect(stripReasoning({ choices: [{ message: "not-an-object" }] })).toEqual({
      choices: [{ message: "not-an-object" }],
    });
  });
});

describe("createCassetteFetch", () => {
  it("replays a committed response and reports misses", async () => {
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
    // A non-json sibling must be ignored when loading the directory.
    await writeFile(path.join(dir, "notes.txt"), "ignore me", "utf8");

    const hit = await createCassetteFetch({ dir, mode: "replay" });
    const response = await hit.fetchFn(
      "https://openrouter.ai/api/v1/chat/completions",
      post(REQUEST),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      choices: [{ message: { content: '{"items":[]}' } }],
    });
    expect(hit.misses()).toEqual([]);

    const miss = await createCassetteFetch({ dir, mode: "replay" });
    await expect(
      miss.fetchFn(
        "https://openrouter.ai/api/v1/chat/completions",
        post({ ...REQUEST, messages: [{ role: "user", content: "drifted" }] }),
      ),
    ).rejects.toThrow(/cassette miss/);
    expect(miss.misses()).toEqual([`categorize:${cassetteKey({ ...REQUEST, messages: [{ role: "user", content: "drifted" }] })}`]);
  });

  it("records a live response, strips reasoning, and prunes stale keys", async () => {
    const dir = await tempDir();
    const staleKey = cassetteKey({
      ...REQUEST,
      messages: [{ role: "user", content: "an older prompt" }],
    });
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, `categorize-${staleKey}.json`),
      JSON.stringify({
        request_hash: staleKey,
        stage: "categorize",
        model: "test-model",
        response: { stale: true },
      }),
      "utf8",
    );

    const recorder = await createCassetteFetch({
      dir,
      mode: "record",
      liveFetch: liveFetchReturning({
        choices: [
          {
            message: {
              content: "{}",
              reasoning_details: [{ data: "gAAAAAB-secret-looking" }],
            },
          },
        ],
      }),
    });
    const response = await recorder.fetchFn(
      "https://openrouter.ai/api/v1/chat/completions",
      post(REQUEST),
    );
    expect(response.ok).toBe(true);
    await recorder.settled();
    await recorder.flush({ prune: true });

    const files = await readdir(dir);
    expect(files).toEqual([`categorize-${cassetteKey(REQUEST)}.json`]);
    const written = JSON.parse(await readFile(path.join(dir, files[0]), "utf8")) as {
      model: string;
      response: { choices: { message: Record<string, unknown> }[] };
    };
    expect(written.model).toBe("test-model");
    expect(written.response.choices[0].message).not.toHaveProperty("reasoning_details");
    expect(written.response.choices[0].message.content).toBe("{}");
  });

  it("does not record a non-ok live response and does not create the cassette dir", async () => {
    const parent = await tempDir();
    const dir = path.join(parent, "nested-cassettes");
    const recorder = await createCassetteFetch({
      dir,
      mode: "record",
      liveFetch: liveFetchReturning({ error: "nope" }, 500),
    });
    const response = await recorder.fetchFn(
      "https://openrouter.ai/api/v1/chat/completions",
      post(REQUEST),
    );
    expect(response.status).toBe(500);
    await recorder.flush({ prune: true });
    await expect(access(dir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps a re-recorded key when prune runs against the same prompt", async () => {
    const dir = await tempDir();
    const key = cassetteKey(REQUEST);
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, `categorize-${key}.json`),
      JSON.stringify({
        request_hash: key,
        stage: "categorize",
        model: "old-model",
        response: { stale: true },
      }),
      "utf8",
    );

    const recorder = await createCassetteFetch({
      dir,
      mode: "record",
      liveFetch: liveFetchReturning({ choices: [{ message: { content: '{"items":[]}' } }] }),
    });
    await recorder.fetchFn("https://openrouter.ai/api/v1/chat/completions", post(REQUEST));
    await recorder.flush({ prune: true });

    const files = await readdir(dir);
    expect(files).toEqual([`categorize-${key}.json`]);
    const written = JSON.parse(await readFile(path.join(dir, files[0]), "utf8")) as {
      model: string;
      response: unknown;
    };
    expect(written.model).toBe("test-model");
    expect(written.response).toEqual({ choices: [{ message: { content: '{"items":[]}' } }] });
  });

  it("prunes a missing stale path without throwing", async () => {
    const dir = await tempDir();
    const staleKey = cassetteKey({
      ...REQUEST,
      messages: [{ role: "user", content: "ghost" }],
    });
    await mkdir(dir, { recursive: true });
    // Seed loadDir with a stale entry whose file we then delete before flush.
    await writeFile(
      path.join(dir, `categorize-${staleKey}.json`),
      JSON.stringify({
        request_hash: staleKey,
        stage: "categorize",
        model: "test-model",
        response: { stale: true },
      }),
      "utf8",
    );
    const recorder = await createCassetteFetch({
      dir,
      mode: "record",
      liveFetch: liveFetchReturning({ choices: [{ message: { content: "{}" } }] }),
    });
    await rm(path.join(dir, `categorize-${staleKey}.json`));
    await recorder.fetchFn("https://openrouter.ai/api/v1/chat/completions", post(REQUEST));
    await expect(recorder.flush({ prune: true })).resolves.toBeUndefined();
    expect(await readdir(dir)).toEqual([`categorize-${cassetteKey(REQUEST)}.json`]);
  });

  it("uses the provided liveFetch rather than global fetch in live mode", async () => {
    const dir = await tempDir();
    let called = 0;
    const liveFetch = (async () => {
      called += 1;
      return new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }] }), {
        status: 200,
      });
    }) as unknown as typeof fetch;

    const live = await createCassetteFetch({ dir, mode: "live", liveFetch });
    await live.fetchFn("https://openrouter.ai/api/v1/chat/completions", post(REQUEST));
    expect(called).toBe(1);
    await live.flush();
    // live mode must not write cassettes
    expect(await readdir(dir)).toEqual([]);
  });

  it("keeps every recording when flush is called without prune", async () => {
    const dir = await tempDir();
    const first = await createCassetteFetch({
      dir,
      mode: "record",
      liveFetch: liveFetchReturning({ choices: [{ message: { content: "{}" } }] }),
    });
    await first.fetchFn(
      "https://openrouter.ai/api/v1/chat/completions",
      post({ ...REQUEST, messages: [{ role: "user", content: "first" }] }),
    );
    await first.flush({ prune: true });

    const partial = await createCassetteFetch({
      dir,
      mode: "record",
      liveFetch: liveFetchReturning({ choices: [{ message: { content: "{}" } }] }),
    });
    await partial.fetchFn("https://openrouter.ai/api/v1/chat/completions", post(REQUEST));
    await partial.flush();

    expect(await readdir(dir)).toHaveLength(2);
  });
});

describe("settled", () => {
  it("waits for a request still in flight", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let completed = 0;
    const liveFetch = (async () => {
      await gate;
      completed += 1;
      return new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }] }), {
        status: 200,
      });
    }) as unknown as typeof fetch;

    const cassette = await createCassetteFetch({
      dir: await tempDir(),
      mode: "live",
      liveFetch,
    });
    const pending = cassette.fetchFn(
      "https://openrouter.ai/api/v1/chat/completions",
      post(REQUEST),
    );
    const settledPromise = cassette.settled().then(() => {
      expect(completed).toBe(1);
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(completed).toBe(0);
    release();
    await settledPromise;
    await pending;
  });

  it("resolves immediately when nothing is in flight", async () => {
    const cassette = await createCassetteFetch({ dir: await tempDir(), mode: "replay" });
    await expect(cassette.settled()).resolves.toBeUndefined();
  });
});
