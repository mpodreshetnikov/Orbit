import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

function taskBody(id: string, title: string): string {
  return `---
id: ${id}
title: "${title}"
status: open
owner: TBD
---

## Context

Body for ${id}.
`;
}

describe("getWorkBoardGithubToken", () => {
  it("reads ORBIT_TASKS_GITHUB_TOKEN", () => {
    delete process.env.ORBIT_TASKS_GITHUB_TOKEN;
    expect(getWorkBoardGithubToken()).toBeNull();
    process.env.ORBIT_TASKS_GITHUB_TOKEN = " ghp_test ";
    expect(getWorkBoardGithubToken()).toBe("ghp_test");
    expect(getWorkBoardGithubToken({ ORBIT_TASKS_GITHUB_TOKEN: "x" })).toBe("x");
  });
});

describe("fetchOrbitTaskTexts", () => {
  it("requires a RO token when no tasks dir override is set", async () => {
    delete process.env.ORBIT_TASKS_GITHUB_TOKEN;
    delete process.env.ORBIT_WORK_BOARD_TASKS_DIR;
    await expect(fetchOrbitTaskTexts()).rejects.toThrow(/ORBIT_TASKS_GITHUB_TOKEN/);
  });

  it("loads markdown from a local tasks dir when configured", async () => {
    const dir = mkdtempSync(join(tmpdir(), "orbit-wb-"));
    writeFileSync(join(dir, "T-999901-loc.md"), taskBody("T-999901-loc", "Local"));
    writeFileSync(join(dir, "README.md"), "skip");
    mkdirSync(join(dir, "T-999901-dir.md")); // not a file
    process.env.ORBIT_WORK_BOARD_TASKS_DIR = ` ${dir} `;
    delete process.env.ORBIT_TASKS_GITHUB_TOKEN;

    const texts = await fetchOrbitTaskTexts({ env: process.env });
    expect(texts).toEqual([
      expect.objectContaining({
        path: "docs/tasks/T-999901-loc.md",
        text: expect.stringContaining("Local"),
      }),
    ]);
  });

  it("loads markdown from GitHub tree + blobs with the RO token", async () => {
    process.env.ORBIT_TASKS_GITHUB_TOKEN = "ghp_test";
    process.env.ORBIT_TASKS_GITHUB_REPO = "mpodreshetnikov/orbit-tasks";
    delete process.env.ORBIT_WORK_BOARD_TASKS_DIR;

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      expect(headers.get("Authorization")).toBe("Bearer ghp_test");
      expect(headers.get("Accept")).toBe("application/vnd.github+json");
      expect(headers.get("User-Agent")).toBe("orbit-work-board");
      expect(headers.get("X-GitHub-Api-Version")).toBe("2022-11-28");

      if (url.includes("/git/trees/main")) {
        expect(url).toContain("mpodreshetnikov/orbit-tasks");
        return new Response(
          JSON.stringify({
            tree: [
              { path: "docs/tasks/T-999901-aaa.md", type: "blob", sha: "sha-a" },
              { path: "docs/tasks/README.md", type: "blob", sha: "sha-r" },
              { path: "docs/tasks/goals/x.md", type: "blob", sha: "sha-g" },
              { path: "docs/tasks/T-999901-tree.md", type: "tree", sha: "sha-t" },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.includes("/git/blobs/sha-a")) {
        const body = taskBody("T-999901-aaa", "From github");
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

    const texts = await fetchOrbitTaskTexts({ fetchImpl: fetchMock });
    expect(texts).toHaveLength(1);
    expect(texts[0]?.path).toBe("docs/tasks/T-999901-aaa.md");
    expect(texts[0]?.text).toContain("From github");
    expect(fetchMock).toHaveBeenCalled();
  });

  it("defaults the repo when ORBIT_TASKS_GITHUB_REPO is blank", async () => {
    process.env.ORBIT_TASKS_GITHUB_TOKEN = "ghp_test";
    process.env.ORBIT_TASKS_GITHUB_REPO = "   ";
    delete process.env.ORBIT_WORK_BOARD_TASKS_DIR;

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/git/trees/main")) {
        expect(url).toContain("repos/mpodreshetnikov/orbit-tasks/");
        return new Response(JSON.stringify({ tree: [] }), { status: 200 });
      }
      return new Response("no", { status: 404 });
    });

    await expect(fetchOrbitTaskTexts({ fetchImpl: fetchMock })).resolves.toEqual([]);
  });

  it("surfaces GitHub HTTP errors and bad blob encodings", async () => {
    process.env.ORBIT_TASKS_GITHUB_TOKEN = "ghp_test";
    delete process.env.ORBIT_WORK_BOARD_TASKS_DIR;

    const longBody = `boom-${"x".repeat(250)}`;
    const failing = vi.fn(async () => new Response(longBody, { status: 403 }));
    await expect(fetchOrbitTaskTexts({ fetchImpl: failing })).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(Error);
      const message = (err as Error).message;
      expect(message).toMatch(/^GitHub 403 for .+: boom-x{195}$/);
      expect(message.endsWith("x".repeat(195))).toBe(true);
      expect(message).not.toContain("x".repeat(196));
      return true;
    });

    const badEncoding = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/git/trees/main")) {
        return new Response(
          JSON.stringify({
            tree: [{ path: "docs/tasks/T-999901-aaa.md", type: "blob", sha: "sha-a" }],
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ content: "abc", encoding: "utf-8" }), { status: 200 });
    });
    await expect(fetchOrbitTaskTexts({ fetchImpl: badEncoding })).rejects.toThrow(
      /Unexpected blob encoding/,
    );

    const missingContent = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/git/trees/main")) {
        return new Response(
          JSON.stringify({
            tree: [{ path: "docs/tasks/T-999901-aaa.md", type: "blob", sha: "sha-a" }],
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ encoding: "base64" }), { status: 200 });
    });
    await expect(fetchOrbitTaskTexts({ fetchImpl: missingContent })).rejects.toThrow(
      /Unexpected blob encoding/,
    );
  });
});

describe("loadWorkBoardCards", () => {
  it("caches results for the configured TTL (~15 min default) and reports cacheHit", async () => {
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
          const body = taskBody("T-999901-aaa", "Cached");
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
    expect(first.cacheHit).toBe(false);
    expect(first.source).toBe("github");
    expect(first.generatedAt).toBe("1970-01-01 00:00 UTC");

    const second = await loadWorkBoardCards({ nowMs: 1_000 + WORK_BOARD_CACHE_TTL_MS_DEFAULT - 1 });
    expect(second.cacheHit).toBe(true);
    expect(second.generatedAt).toBe(first.generatedAt);
    expect(treeCalls).toBe(1);

    // Exactly at expiry boundary: expiresAtMs > nowMs is false when equal
    const atExpiry = await loadWorkBoardCards({
      nowMs: 1_000 + WORK_BOARD_CACHE_TTL_MS_DEFAULT,
    });
    expect(atExpiry.cacheHit).toBe(false);
    expect(treeCalls).toBe(2);

    clearWorkBoardCache();
    const afterClear = await loadWorkBoardCards({ nowMs: 2_000 });
    expect(afterClear.cacheHit).toBe(false);
    expect(treeCalls).toBe(3);
  });

  it("uses custom TTL overrides and rejects invalid TTL values", async () => {
    process.env.ORBIT_TASKS_GITHUB_TOKEN = "ghp_test";
    delete process.env.ORBIT_WORK_BOARD_TASKS_DIR;

    let treeCalls = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/git/trees/main")) {
        treeCalls += 1;
        return new Response(JSON.stringify({ tree: [] }), { status: 200 });
      }
      return new Response("no", { status: 404 });
    });

    process.env.ORBIT_WORK_BOARD_CACHE_TTL_MS = " 50 ";
    await loadWorkBoardCards({ nowMs: 10, fetchImpl });
    expect((await loadWorkBoardCards({ nowMs: 40, fetchImpl })).cacheHit).toBe(true);
    expect((await loadWorkBoardCards({ nowMs: 70, fetchImpl })).cacheHit).toBe(false);

    clearWorkBoardCache();
    process.env.ORBIT_WORK_BOARD_CACHE_TTL_MS = "-5";
    await loadWorkBoardCards({ nowMs: 100, fetchImpl });
    // invalid TTL falls back to default 15min — still cached shortly after
    expect((await loadWorkBoardCards({ nowMs: 200, fetchImpl })).cacheHit).toBe(true);

    clearWorkBoardCache();
    process.env.ORBIT_WORK_BOARD_CACHE_TTL_MS = "not-a-number";
    await loadWorkBoardCards({ nowMs: 300, fetchImpl });
    expect((await loadWorkBoardCards({ nowMs: 400, fetchImpl })).cacheHit).toBe(true);

    clearWorkBoardCache();
    delete process.env.ORBIT_WORK_BOARD_CACHE_TTL_MS;
    await loadWorkBoardCards({ nowMs: 500, fetchImpl });
    expect((await loadWorkBoardCards({ nowMs: 600, fetchImpl })).cacheHit).toBe(true);

    expect(treeCalls).toBeGreaterThanOrEqual(4);
  });

  it("formats generatedAt with zero-padded UTC fields and local-dir source", async () => {
    const dir = mkdtempSync(join(tmpdir(), "orbit-wb-"));
    writeFileSync(join(dir, "T-999901-pad.md"), taskBody("T-999901-pad", "Pad"));
    const result = await loadWorkBoardCards({
      nowMs: Date.UTC(2026, 0, 5, 3, 4), // month is 0-based → January
      env: { ORBIT_WORK_BOARD_TASKS_DIR: dir },
    });
    expect(result.source).toBe("local-dir");
    expect(result.generatedAt).toBe("2026-01-05 03:04 UTC");
    expect(result.cards[0]?.id).toBe("T-999901-pad");
  });

  it("accepts TTL 0 as always-expired and supports calling without options", async () => {
    process.env.ORBIT_TASKS_GITHUB_TOKEN = "ghp_test";
    process.env.ORBIT_WORK_BOARD_CACHE_TTL_MS = "0";
    delete process.env.ORBIT_WORK_BOARD_TASKS_DIR;

    let treeCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/git/trees/main")) {
          treeCalls += 1;
          return new Response(JSON.stringify({ tree: [] }), { status: 200 });
        }
        return new Response("no", { status: 404 });
      }),
    );

    expect((await loadWorkBoardCards({ nowMs: 10 })).cacheHit).toBe(false);
    expect((await loadWorkBoardCards({ nowMs: 10 })).cacheHit).toBe(false);
    expect(treeCalls).toBe(2);

    clearWorkBoardCache();
    delete process.env.ORBIT_WORK_BOARD_CACHE_TTL_MS;
    process.env.ORBIT_WORK_BOARD_TASKS_DIR = mkdtempSync(join(tmpdir(), "orbit-wb-"));
    // No options object — exercises optional chaining on undefined options.
    const bare = await loadWorkBoardCards();
    expect(bare.cacheHit).toBe(false);
    expect(bare.source).toBe("local-dir");
  });
});
