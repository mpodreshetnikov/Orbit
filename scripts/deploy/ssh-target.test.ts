import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const helper = path.resolve(__dirname, "../../deploy/ci/ssh-target.sh");

function parse(host: string, port = ""): { ok: boolean; out: string; err: string } {
  const script = `
set -euo pipefail
source ${JSON.stringify(helper)}
if orbit_parse_ssh_target ${JSON.stringify(host)} ${JSON.stringify(port)}; then
  printf '%s %s\\n' "$ORBIT_SSH_HOST" "$ORBIT_SSH_PORT"
else
  exit 1
fi
`;
  try {
    const out = execFileSync("bash", ["-c", script], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, out: out.trim(), err: "" };
  } catch (error) {
    const err = error as { stderr?: string; stdout?: string; status?: number };
    return {
      ok: false,
      out: (err.stdout ?? "").trim(),
      err: (err.stderr ?? String(error)).trim(),
    };
  }
}

describe("orbit_parse_ssh_target", () => {
  it("defaults bare IPv4 host to port 22", () => {
    expect(parse("141.133.186.73")).toEqual({
      ok: true,
      out: "141.133.186.73 22",
      err: "",
    });
  });

  it("defaults bare hostname to port 22", () => {
    expect(parse("orbit.example")).toEqual({
      ok: true,
      out: "orbit.example 22",
      err: "",
    });
  });

  it("accepts host:port in ORBIT_SERVER_HOST", () => {
    expect(parse("141.133.186.73:22222")).toEqual({
      ok: true,
      out: "141.133.186.73 22222",
      err: "",
    });
  });

  it("accepts explicit ORBIT_SERVER_PORT with bare host", () => {
    expect(parse("141.133.186.73", "22222")).toEqual({
      ok: true,
      out: "141.133.186.73 22222",
      err: "",
    });
  });

  it("accepts matching host:port and ORBIT_SERVER_PORT", () => {
    expect(parse("141.133.186.73:22222", "22222")).toEqual({
      ok: true,
      out: "141.133.186.73 22222",
      err: "",
    });
  });

  it("rejects disagreeing host:port and ORBIT_SERVER_PORT", () => {
    const result = parse("141.133.186.73:22222", "22");
    expect(result.ok).toBe(false);
    expect(result.err).toMatch(/disagrees/i);
  });

  it("rejects empty host", () => {
    const result = parse("");
    expect(result.ok).toBe(false);
    expect(result.err).toMatch(/empty/i);
  });

  it("rejects invalid ORBIT_SERVER_PORT", () => {
    const result = parse("host.example", "0");
    expect(result.ok).toBe(false);
    expect(result.err).toMatch(/ORBIT_SERVER_PORT/i);
  });

  it("rejects IPv6 bracket form (unsupported)", () => {
    const result = parse("[2001:db8::1]:22");
    expect(result.ok).toBe(false);
    expect(result.err).toMatch(/IPv6/i);
  });

  it("rejects bare IPv6 / multi-colon forms (unsupported)", () => {
    const result = parse("2001:db8::1");
    expect(result.ok).toBe(false);
    expect(result.err).toMatch(/IPv6|multi-colon/i);
  });
});
