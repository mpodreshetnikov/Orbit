import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cassetteKey, createCassetteFetch, stripReasoning } from "./cassette";

const dirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "cassette-"));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const REQUEST = {
  model: "test-model",
  messages: [{ role: "user", content: "Extract clinical entities from the document." }],
};

function post(body: unknown): RequestInit {
  return { method: "POST", body: JSON.stringify(body) };
}

function liveFetchReturning(payload: unknown): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(payload), { status: 200 })) as unknown as typeof fetch;
}

describe("cassetteKey", () => {
  it("is stable for the same model and messages", () => {
    expect(cassetteKey(REQUEST)).toBe(cassetteKey({ ...REQUEST }));
  });

  it("changes when the prompt changes", () => {
    const other = { ...REQUEST, messages: [{ role: "user", content: "different" }] };
    expect(cassetteKey(other)).not.toBe(cassetteKey(REQUEST));
  });

  it("changes when the model changes, so a recording is never reused across models", () => {
    expect(cassetteKey({ ...REQUEST, model: "other-model" })).not.toBe(cassetteKey(REQUEST));
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

  it("drops the reasoning trace, which no reader wants and secret scanners flag", () => {
    const stripped = stripReasoning(withReasoning) as typeof withReasoning;
    expect(stripped.choices[0].message).not.toHaveProperty("reasoning");
    expect(stripped.choices[0].message).not.toHaveProperty("reasoning_details");
    expect(JSON.stringify(stripped)).not.toContain("gAAAAAB");
  });

  it("keeps everything the stage client actually reads", () => {
    const stripped = stripReasoning(withReasoning) as typeof withReasoning;
    expect(stripped.choices[0].message.content).toBe("{}");
    expect(stripped.choices[0].finish_reason).toBe("stop");
    expect(stripped.usage).toEqual({ prompt_tokens: 10, completion_tokens: 2 });
  });

  it("passes through a payload with no choices rather than reshaping it", () => {
    const error = { error: { message: "nope", code: 400 } };
    expect(stripReasoning(error)).toEqual(error);
  });
});

describe("createCassetteFetch", () => {
  it("deletes recordings the case no longer asks for", async () => {
    const dir = await tempDir();
    // A previous recording under an old prompt. Editing a prompt changes the key, so a re-record
    // adds a file instead of replacing one and this would otherwise sit here forever.
    const recorder = await createCassetteFetch({
      dir,
      mode: "record",
      liveFetch: liveFetchReturning({ choices: [{ message: { content: "{}" } }] }),
    });
    await recorder.fetchFn(
      "https://openrouter.ai/api/v1/chat/completions",
      post({ ...REQUEST, messages: [{ role: "user", content: "an older prompt" }] }),
    );
    await recorder.flush({ prune: true });
    expect(await readdir(dir)).toHaveLength(1);

    const rerecord = await createCassetteFetch({
      dir,
      mode: "record",
      liveFetch: liveFetchReturning({ choices: [{ message: { content: "{}" } }] }),
    });
    await rerecord.fetchFn("https://openrouter.ai/api/v1/chat/completions", post(REQUEST));
    await rerecord.flush({ prune: true });

    const files = await readdir(dir);
    expect(files).toHaveLength(1);
    expect(files[0]).toContain(cassetteKey(REQUEST));
  });

  it("keeps every recording when the case did not finish", async () => {
    // A case that dies at reconcile recorded only classify and extract. Pruning on that would
    // delete a good reconcile cassette and turn one bad run into a corpus that cannot replay.
    const dir = await tempDir();
    const first = await createCassetteFetch({
      dir,
      mode: "record",
      liveFetch: liveFetchReturning({ choices: [{ message: { content: "{}" } }] }),
    });
    await first.fetchFn(
      "https://openrouter.ai/api/v1/chat/completions",
      post({ ...REQUEST, messages: [{ role: "user", content: "reconcile-ish" }] }),
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

  it("strips the reasoning trace before it reaches disk", async () => {
    const dir = await tempDir();
    const payload = {
      choices: [
        { message: { content: "{}", reasoning_details: [{ data: "gAAAAAB-secret-looking" }] } },
      ],
    };

    const recorder = await createCassetteFetch({
      dir,
      mode: "record",
      liveFetch: liveFetchReturning(payload),
    });
    await recorder.fetchFn("https://openrouter.ai/api/v1/chat/completions", post(REQUEST));
    await recorder.flush();

    const files = await readdir(dir);
    const written = await readFile(path.join(dir, files[0]), "utf8");
    expect(written).not.toContain("gAAAAAB-secret-looking");
    expect(written).toContain('"content": "{}"');
  });

  it("records a live response and replays it byte for byte", async () => {
    const dir = await tempDir();
    const payload = { choices: [{ message: { content: "{}" } }] };

    const recorder = await createCassetteFetch({
      dir,
      mode: "record",
      liveFetch: liveFetchReturning(payload),
    });
    await recorder.fetchFn("https://openrouter.ai/api/v1/chat/completions", post(REQUEST));
    await recorder.flush();

    const files = await readdir(dir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^extract-[0-9a-f]{16}\.json$/);

    const replayer = await createCassetteFetch({
      dir,
      mode: "replay",
      // Any live call here would be a bug: replay must never reach the network.
      liveFetch: (() => {
        throw new Error("replay must not call the network");
      }) as unknown as typeof fetch,
    });
    const replayed = await replayer.fetchFn(
      "https://openrouter.ai/api/v1/chat/completions",
      post(REQUEST),
    );
    expect(replayed.status).toBe(200);
    expect(await replayed.json()).toEqual(payload);
  });

  it("fails loudly on a miss instead of silently calling the provider", async () => {
    const dir = await tempDir();
    const replayer = await createCassetteFetch({ dir, mode: "replay" });
    await expect(
      replayer.fetchFn("https://openrouter.ai/api/v1/chat/completions", post(REQUEST)),
    ).rejects.toThrow(/cassette miss[\s\S]*--record/);
    expect(replayer.misses()).toHaveLength(1);
  });

  it("treats a changed prompt as a miss rather than replaying the old answer", async () => {
    const dir = await tempDir();
    const recorder = await createCassetteFetch({
      dir,
      mode: "record",
      liveFetch: liveFetchReturning({ ok: true }),
    });
    await recorder.fetchFn("https://openrouter.ai/api/v1/chat/completions", post(REQUEST));
    await recorder.flush();

    const replayer = await createCassetteFetch({ dir, mode: "replay" });
    await expect(
      replayer.fetchFn(
        "https://openrouter.ai/api/v1/chat/completions",
        post({ ...REQUEST, messages: [{ role: "user", content: "reworded prompt" }] }),
      ),
    ).rejects.toThrow(/cassette miss/);
  });

  it("does not record a failed response", async () => {
    const dir = await tempDir();
    const recorder = await createCassetteFetch({
      dir,
      mode: "record",
      liveFetch: (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch,
    });
    await recorder.fetchFn("https://openrouter.ai/api/v1/chat/completions", post(REQUEST));
    await recorder.flush();
    expect(await readdir(dir)).toHaveLength(0);
  });
});
