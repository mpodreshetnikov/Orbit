import { describe, expect, it } from "vitest";
import {
  applyOwnerSpecWaive,
  evaluateCodeGateWithOwnerWaive,
  parseOwnerSpecWaive,
} from "./spec-owner-waive.cjs";

const maxim = "mpodreshetnikov@gmail.com";
const igor = "workupnow@yandex.ru";

describe("parseOwnerSpecWaive", () => {
  it("matches the owner login case-insensitively, with or without @", () => {
    expect(parseOwnerSpecWaive("Spec waived by mpodreshetnikov for polish.", maxim)).toEqual({
      login: "mpodreshetnikov",
    });
    expect(parseOwnerSpecWaive("spec waived by @MPODRESHETNIKOV", maxim)).toEqual({
      login: "mpodreshetnikov",
    });
  });

  it("ignores waives by the other participant and unknown owners", () => {
    expect(parseOwnerSpecWaive("Spec waived by Kot-kAkos.", maxim)).toBeNull();
    expect(parseOwnerSpecWaive("Spec waived by mpodreshetnikov.", "nobody@example.com")).toBeNull();
    expect(parseOwnerSpecWaive("no waive here", maxim)).toBeNull();
  });

  it("uses the last matching owner waive when several appear", () => {
    const text = "Spec waived by Kot-kAkos.\nSpec waived by mpodreshetnikov.\n";
    expect(parseOwnerSpecWaive(text, maxim)).toEqual({ login: "mpodreshetnikov" });
  });
});

describe("applyOwnerSpecWaive", () => {
  it("leaves successful gates unchanged", () => {
    const ok = { ok: true, code: "simple", message: "ok" };
    expect(applyOwnerSpecWaive(ok, { taskText: "", ownerEmail: maxim })).toBe(ok);
  });

  it("does not override non Spec refusals", () => {
    const foreign = { ok: false, code: "foreign-task", message: "no" };
    expect(
      applyOwnerSpecWaive(foreign, {
        taskText: "Spec waived by mpodreshetnikov.",
        ownerEmail: maxim,
      }),
    ).toBe(foreign);
  });

  it("overrides no-spec and no-second-approve when the owner waived", () => {
    const noSpec = { ok: false, code: "no-spec", message: "missing" };
    const waived = applyOwnerSpecWaive(noSpec, {
      taskText: "Spec waived by mpodreshetnikov.",
      ownerEmail: maxim,
    });
    expect(waived).toEqual({
      ok: true,
      code: "waived",
      message: "spec-approve: Spec waived by owner mpodreshetnikov",
    });

    const noSecond = { ok: false, code: "no-second-approve", message: "need igor" };
    expect(
      applyOwnerSpecWaive(noSecond, {
        taskText: "Spec waived by mpodreshetnikov.",
        ownerEmail: maxim,
      }).code,
    ).toBe("waived");
  });

  it("keeps the refusal when waive is absent or for the wrong owner", () => {
    const noSecond = { ok: false, code: "no-second-approve", message: "need igor" };
    expect(
      applyOwnerSpecWaive(noSecond, {
        taskText: "Spec waived by Kot-kAkos.",
        ownerEmail: maxim,
      }),
    ).toBe(noSecond);
    expect(applyOwnerSpecWaive(noSecond, { taskText: "", ownerEmail: maxim })).toBe(noSecond);
  });
});

describe("evaluateCodeGateWithOwnerWaive", () => {
  it("forwards input to evaluateCodeGate and applies waive on Spec refusals", () => {
    const calls: unknown[] = [];
    const evaluate = (input: unknown) => {
      calls.push(input);
      return { ok: false, code: "no-second-approve", message: "need" };
    };
    const input = {
      taskText: `---\nowner: ${maxim}\n---\nSpec waived by mpodreshetnikov.\n`,
      ownerEmail: maxim,
    };
    const result = evaluateCodeGateWithOwnerWaive(evaluate, input);
    expect(calls).toEqual([input]);
    expect(result.code).toBe("waived");
  });

  it("returns the inner result when waive does not apply", () => {
    const evaluate = () => ({ ok: false, code: "agent-executor", message: "no" });
    expect(
      evaluateCodeGateWithOwnerWaive(evaluate, {
        taskText: "Spec waived by mpodreshetnikov.",
        ownerEmail: maxim,
      }).code,
    ).toBe("agent-executor");
  });
});

describe("igor owner waive", () => {
  it("accepts Igor waiving his own complex task", () => {
    expect(parseOwnerSpecWaive("Spec waived by Kot-kAkos.", igor)).toEqual({ login: "Kot-kAkos" });
  });
});
