import crypto from "node:crypto";
import { describe, expect, it } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const api = require("./api-local-docker.cjs");
const { envLines, keys, signKey, restContainerArgs, authContainerArgs, PID_FILE, JWT_SECRET } = api;

function decode(segment: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
}

describe("local api keys", () => {
  it("signs each key with the secret the services are started with", () => {
    // The published local keys would work until someone changed the secret, and then fail as
    // an ordinary 401 with nothing pointing at the cause. Deriving them means the two can
    // never disagree.
    const token = signKey("service_role");
    const [header, payload, signature] = token.split(".");
    const expected = crypto
      .createHmac("sha256", JWT_SECRET)
      .update(`${header}.${payload}`)
      .digest("base64url");
    expect(signature).toBe(expected);
  });

  it("puts the role PostgREST switches on into the claims", () => {
    // PostgREST reads `role` and becomes that database role. A key without it is anonymous
    // whatever it is called.
    expect(decode(signKey("anon").split(".")[1]).role).toBe("anon");
    expect(decode(signKey("service_role").split(".")[1]).role).toBe("service_role");
  });

  it("issues keys that outlive a test run", () => {
    const payload = decode(signKey("anon").split(".")[1]) as { iat: number; exp: number };
    expect(payload.exp - payload.iat).toBeGreaterThan(60 * 60 * 24);
  });

  it("gives the two keys the lane needs", () => {
    const pair = keys();
    expect(pair.anonKey).not.toBe(pair.serviceRoleKey);
    expect(decode(pair.anonKey.split(".")[1]).role).toBe("anon");
    expect(decode(pair.serviceRoleKey.split(".")[1]).role).toBe("service_role");
  });
});

describe("local api env", () => {
  it("prints what the e2e runner reads out of `supabase status -o env`", () => {
    // `run-e2e.cjs` parses `KEY="value"` lines and looks for exactly these names. Printing a
    // different shape here would make the lane load as an empty environment and the app would
    // point at production defaults.
    const lines: string[] = envLines();
    const parsed = new Map(
      lines.map((line) => {
        const match = line.match(/^([A-Z0-9_]+)="(.*)"$/);
        expect(match, `not a status line: ${line}`).not.toBeNull();
        return [match![1], match![2]] as const;
      }),
    );
    for (const name of ["API_URL", "DB_URL", "ANON_KEY", "SERVICE_ROLE_KEY"]) {
      expect(parsed.has(name), `missing ${name}`).toBe(true);
      expect(parsed.get(name)).not.toBe("");
    }
    expect(parsed.get("API_URL")).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });
});

describe("local api service binds", () => {
  // The two upstreams run with host networking, so what they bind to is the whole of their
  // exposure. A wildcard listener publishes them on every interface of the machine — and this
  // lane signs its keys with a secret that is in this repository, so anyone who could reach the
  // port could mint a service_role token and read the database through PostgREST's admin
  // surface. Verified once with a real request from this host's non-loopback address, refused
  // after the fix; asserted here so it cannot drift back.
  it("binds PostgREST to loopback rather than its wildcard default", () => {
    const args: string[] = restContainerArgs();
    expect(args).toContain("PGRST_SERVER_HOST=127.0.0.1");
    expect(args.some((arg) => /^PGRST_SERVER_HOST=(?!127\.0\.0\.1$)/.test(arg))).toBe(false);
  });

  it("binds GoTrue to loopback rather than 0.0.0.0", () => {
    const args: string[] = authContainerArgs();
    expect(args).toContain("GOTRUE_API_HOST=127.0.0.1");
    expect(args).not.toContain("GOTRUE_API_HOST=0.0.0.0");
  });

  it("keeps host networking, which is why the bind matters", () => {
    // If this ever becomes published ports instead, the bind above stops being the whole story
    // and this suite should be revisited rather than silently still passing.
    for (const args of [restContainerArgs(), authContainerArgs()]) {
      expect(args).toContain("--network");
      expect(args[args.indexOf("--network") + 1]).toBe("host");
    }
  });
});

describe("local api pid file", () => {
  it("is named for the lane, like the containers are", () => {
    // `db-local-docker.cjs` derives its auxiliary container names from ORBIT_DB_CONTAINER, and
    // its own comment says why: fixed names once made one stack's teardown remove another
    // stack's containers. A single fixed pid file is that bug again — the second lane's `up`
    // would overwrite the first lane's pids, and either lane's `down` would then stop the wrong
    // processes and leak the others.
    expect(String(PID_FILE)).toContain(process.env.ORBIT_DB_CONTAINER ?? "orbit_db");
  });
});
