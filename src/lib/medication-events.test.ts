import { describe, expect, it, vi } from "vitest";
import { getClientTimezone, regenerateMedicationEvents } from "./medication-events";

describe("medication-events", () => {
  it("returns client timezone when Intl is available", () => {
    expect(typeof getClientTimezone()).toBe("string");
  });

  it("posts regenerate request with optional payload", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    await regenerateMedicationEvents("Europe/Berlin", "person-1");

    expect(fetchMock).toHaveBeenCalledOnce();
    const [, options] = fetchMock.mock.calls[0];
    expect(options).toMatchObject({
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    expect(JSON.parse(String(options?.body))).toEqual({
      timezone: "Europe/Berlin",
      person_id: "person-1",
    });
  });

  it("throws when endpoint returns error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "Nope" }), { status: 400 }),
    );

    await expect(regenerateMedicationEvents()).rejects.toThrow("Nope");
  });
});
