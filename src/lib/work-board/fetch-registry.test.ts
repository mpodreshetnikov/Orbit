import { afterEach, describe, expect, it, vi } from "vitest";
import {
  WORK_BOARD_CACHE_TTL_MS_DEFAULT,
  clearWorkBoardCache,
  fetchOrbitTaskTexts,
  getWorkBoardGithubToken,
  loadWorkBoardCards,
} from "./fetch-registry";

const ORIGINAL = {
  token: process.env.ORBIT_TASKS_GITHUB_TOKEN,
  repo: process.env.ORBIT_TASKS_GITHUB_REPO,
  tasksDir: process.env.ORBIT_WORK_BOARD_TASKS_DIR,
  ttl: process.env.ORBIT_WORK_BOARD_CACHE_TTL_MS,
};

afterEach(() => {
  clearWorkBoardCache();
  vi.unstubAllGlobals();
  for (const [key, value] of Object.entries({
    ORBIT_TASKS_GITHUB_TOKEN: ORIGINAL.token,
    ORBIT_TASKS_GITHUB_REPO: ORIGINAL.repo,
    ORBIT_WORK_BOARD_TASKS_DIR: ORIGINAL.tasksDir,
    ORBIT_WORK_BOARD_CACHE_TTL_MS: ORIGINAL.ttl,
  })) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe("getWorkBoardGithubToken", () => {
  it("reads ORBIT_TASKS_GITHUB_TOKEN", () => {
    delete process.env.ORBIT_TASKS_GITHUB_TOKEN;
    expect(getWorkBoardGithubToken()).toBeNull();
    process.env.ORBIT_TASKS_GITHUB_TOKEN = " ghp_test ";
    expect(getWorkBoardGithubToken()).toBe("ghp_test");
  });
});

describe("fetchOrbitTaskTexts", () => {
  it("requires a RO token when no tasks dir override is set", async () => {
    delete process.env.ORBIT_TASKS_GITHUB_TOKEN;
    delete process.env.ORBIT_WORK_BOARD_TASKS_DIR;
    await expect(fetchOrbitTaskTexts()).rejects.toThrow(/ORBIT_TASKS_GITHUB_TOKEN/);
  });

  it("loads markdown from GitHub tree + blobs with the RO token", async () => {
    process.env.ORBIT_TASKS_GITHUB_TOKEN = "ghp_test";
    process.env.ORBIT_TASKS_GITHUB_REPO = "mpodreshetnikov/orbit-tasks";
    delete process.env.ORBIT_WORK_BOARD_TASKS_DIR;

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/git/trees/main")) {
        return new Response(
          JSON.stringify({
            tree: [
              { path: "docs/tasks/T-999901-aaa.md", type: "blob", sha: "sha-a" },
              { path: "docs/tasks/README.md", type: "blob", sha: "sha-r" },
              { path: "docs/tasks/goals/x.md", type: "blob", sha: "sha-g" },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.includes("/git/blobs/sha-a")) {
        const body = `---
id: T-999901-aaa
title: "From github"
status: open
owner: TBD
---

## Context

Remote fixture.
`;
        return new Response(
          JSON.stringify({
            content: Buffer.from(body, "utf8").toString("base64"),
            encoding: "base64",
          }),
          { status: 200 },
        );
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const texts = await fetchOrbitTaskTexts();
    expect(texts).toHaveLength(1);
    expect(texts[0]?.path).toBe("docs/tasks/T-999901-aaa.md");
    expect(texts[0]?.text).toContain("From github");
    expect(fetchMock).toHaveBeenCalled();
  });
});

describe("loadWorkBoardCards", () => {
  it("caches results for the configured TTL (~15 min default)", async () => {
    process.env.ORBIT_TASKS_GITHUB_TOKEN = "ghp_test";
    delete process.env.ORBIT_WORK_BOARD_TASKS_DIR;
    process.env.ORBIT_WORK_BOARD_CACHE_TTL_MS = String(WORK_BOARD_CACHE_TTL_MS_DEFAULT);

    let treeCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/git/trees/main")) {
          treeCalls += 1;
          return new Response(
            JSON.stringify({
              tree: [{ path: "docs/tasks/T-999901-aaa.md", type: "blob", sha: "sha-a" }],
            }),
            { status: 200 },
          );
        }
        if (url.includes("/git/blobs/sha-a")) {
          const body = `---
id: T-999901-aaa
title: "Cached"
status: open
owner: TBD
---

## Context

Cached body.
`;
          return new Response(
            JSON.stringify({
              content: Buffer.from(body, "utf8").toString("base64"),
              encoding: "base64",
            }),
            { status: 200 },
          );
        }
        return new Response("no", { status: 404 });
      }),
    );

    const first = await loadWorkBoardCards({ nowMs: 1_000 });
    const second = await loadWorkBoardCards({ nowMs: 1_000 + WORK_BOARD_CACHE_TTL_MS_DEFAULT - 1 });
    expect(first.cards).toHaveLength(1);
    expect(second.cards).toHaveLength(1);
    expect(treeCalls).toBe(1);

    const third = await loadWorkBoardCards({ nowMs: 1_000 + WORK_BOARD_CACHE_TTL_MS_DEFAULT + 1 });
    expect(third.cards).toHaveLength(1);
    expect(treeCalls).toBe(2);
  });
});
