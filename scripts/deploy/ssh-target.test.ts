import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("orbit_parse_ssh_target", () => {
  it("passes deploy/ci/ssh-target.selftest.sh (bare host, host:port, port var, IPv6 reject)", () => {
    const out = execFileSync("bash", ["deploy/ci/ssh-target.selftest.sh"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    expect(out.trim()).toBe("ssh-target.selftest: ok");
  });
});
