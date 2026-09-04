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

describe("stageSpend", () => {
  const RECONCILE = {
    model: "test-model",
    messages: [{ role: "user", content: "Compare against the existing record." }],
  };

  function withUsage(prompt: number, completion: number, cost: number | null): unknown {
    const usage: Record<string, number> = {
      prompt_tokens: prompt,
      completion_tokens: completion,
    };
    if (cost !== null) usage.cost = cost;
    return { choices: [{ message: { content: "{}" } }], usage };
  }

  it("accounts a live call against the stage its prompt names", async () => {
    const cassette = await createCassetteFetch({
      dir: await tempDir(),
      mode: "live",
      liveFetch: liveFetchReturning(withUsage(100, 20, 0.5)),
    });
    await cassette.fetchFn("https://openrouter.test", post(REQUEST));
    expect(cassette.stageSpend()).toEqual([
      { stage: "extract", calls: 1, promptTokens: 100, completionTokens: 20, costUsd: 0.5 },
    ]);
  });

  it("keeps stages apart and sums repeat calls within one", async () => {
    const cassette = await createCassetteFetch({
      dir: await tempDir(),
      mode: "live",
      liveFetch: liveFetchReturning(withUsage(10, 5, 0.25)),
    });
    await cassette.fetchFn("https://openrouter.test", post(REQUEST));
    await cassette.fetchFn("https://openrouter.test", post(REQUEST));
    await cassette.fetchFn("https://openrouter.test", post(RECONCILE));
    expect(cassette.stageSpend()).toEqual([
      { stage: "extract", calls: 2, promptTokens: 20, completionTokens: 10, costUsd: 0.5 },
      { stage: "reconcile", calls: 1, promptTokens: 10, completionTokens: 5, costUsd: 0.25 },
    ]);
  });

  // A stage that saw one unpriced answer cannot report a trustworthy total, and reporting the
  // priced subset as if it were the whole would understate the run — the same reasoning as
  // `CaseDiagnostics.costUsd`.
  it("nulls a stage's cost when any of its calls was unpriced", async () => {
    let call = 0;
    const alternating = (async () => {
      call += 1;
      return new Response(JSON.stringify(withUsage(10, 5, call === 1 ? 0.25 : null)), {
        status: 200,
      });
    }) as unknown as typeof fetch;
    const cassette = await createCassetteFetch({
      dir: await tempDir(),
      mode: "live",
      liveFetch: alternating,
    });
    await cassette.fetchFn("https://openrouter.test", post(REQUEST));
    await cassette.fetchFn("https://openrouter.test", post(REQUEST));
    expect(cassette.stageSpend()[0]).toMatchObject({ calls: 2, costUsd: null });
  });

  // A retried 429 bought nothing, so counting it would inflate the call count with attempts that
  // produced no answer and carried no usage block.
  it("ignores a failed response", async () => {
    const failing = (async () =>
      new Response("rate limited", { status: 429 })) as unknown as typeof fetch;
    const cassette = await createCassetteFetch({
      dir: await tempDir(),
      mode: "live",
      liveFetch: failing,
    });
    await cassette.fetchFn("https://openrouter.test", post(REQUEST));
    expect(cassette.stageSpend()).toEqual([]);
  });

  it("reports the recorded price when replaying", async () => {
    const dir = await tempDir();
    const recording = await createCassetteFetch({
      dir,
      mode: "record",
      liveFetch: liveFetchReturning(withUsage(100, 20, 0.5)),
    });
    await recording.fetchFn("https://openrouter.test", post(REQUEST));
    await recording.flush();

    const replay = await createCassetteFetch({ dir, mode: "replay" });
    await replay.fetchFn("https://openrouter.test", post(REQUEST));
    expect(replay.stageSpend()).toEqual([
      { stage: "extract", calls: 1, promptTokens: 100, completionTokens: 20, costUsd: 0.5 },
    ]);
  });
});

describe("settled", () => {
  // `runStagedParse` runs classify and extract under Promise.all, which rejects the moment either
  // does, without awaiting its sibling. Reading spend at that point misses a charge the account
  // still incurred — on exactly the failed case the per-stage table exists to account for.
  it("waits for a request still in flight when a sibling has already settled", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slowThenFast = (async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      const content = String((body.messages as { content?: unknown }[])?.[0]?.content ?? "");
      if (content.includes("describe it as a whole")) await gate;
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "{}" } }],
          usage: { prompt_tokens: 1, completion_tokens: 1, cost: 0.5 },
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const cassette = await createCassetteFetch({
      dir: await tempDir(),
      mode: "live",
      liveFetch: slowThenFast,
    });
    const slow = cassette.fetchFn(
      "https://openrouter.test",
      post({ model: "m", messages: [{ role: "user", content: "describe it as a whole" }] }),
    );
    await cassette.fetchFn("https://openrouter.test", post(REQUEST));

    // The fast sibling is done; the slow one is not. Without `settled` the snapshot here would
    // hold only the sibling's charge.
    expect(cassette.stageSpend()).toHaveLength(1);
    release();
    await cassette.settled();
    await slow;
    expect(
      cassette
        .stageSpend()
        .map((entry) => entry.stage)
        .sort(),
    ).toEqual(["classify", "extract"]);
  });

  it("resolves immediately when nothing is in flight", async () => {
    const cassette = await createCassetteFetch({ dir: await tempDir(), mode: "replay" });
    await expect(cassette.settled()).resolves.toBeUndefined();
  });
});
