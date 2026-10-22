import { describe, expect, it } from "vitest";
import { describeUpdateStatus, formatSession, toIsoFromInput } from "./helpers";

describe("popup helpers", () => {
  it("formats null session state", () => {
    expect(formatSession(null)).toBe("No active session");
  });

  it("formats session json", () => {
    expect(formatSession({ id: 1 })).toContain('"id": 1');
  });

  it("parses datetime-local input", () => {
    expect(toIsoFromInput("2026-02-10T10:20")).toBe(new Date("2026-02-10T10:20").toISOString());
    expect(toIsoFromInput("")).toBeNull();
    expect(toIsoFromInput("not-a-date")).toBeNull();
  });
});

describe("describeUpdateStatus", () => {
  const base = {
    current_version: "0.1.23",
    latest_version: "0.1.24",
    checked_at: null,
    error: null,
  };

  it("offers the newer version on the button", () => {
    const view = describeUpdateStatus({ ...base, phase: "available" });
    expect(view.buttonLabel).toBe("Update to 0.1.24");
    expect(view.updateAvailable).toBe(true);
  });

  it("says the update waits for the import and disables the button", () => {
    for (const phase of ["waiting_for_import", "reload_pending"]) {
      const view = describeUpdateStatus({ ...base, phase });
      expect(view.text).toContain("as soon as the import in progress ends");
      expect(view.busy).toBe(true);
    }
  });

  it("is busy while an update is under way", () => {
    expect(describeUpdateStatus({ ...base, phase: "staging" }).busy).toBe(true);
  });

  it("tells how to install a missing updater", () => {
    expect(describeUpdateStatus({ ...base, phase: "host_missing" }).text).toContain(
      "updater/install.sh",
    );
  });

  it("says how to fetch now when the browser installs the update", () => {
    expect(
      describeUpdateStatus({ ...base, phase: "browser_will_install", latest_version: "0.1.26" })
        .text,
    ).toContain("about:addons");
  });

  it("shows the error and the state of an up-to-date install", () => {
    expect(describeUpdateStatus({ ...base, phase: "error", error: "boom" }).text).toContain("boom");
    expect(describeUpdateStatus({ ...base, phase: "up_to_date" }).text).toContain("Up to date");
    expect(describeUpdateStatus({ ...base, phase: "idle" }).buttonLabel).toBe("Check for updates");
  });
});
