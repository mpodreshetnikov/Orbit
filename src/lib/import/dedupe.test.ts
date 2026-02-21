import { describe, expect, it } from "vitest";
import { buildDedupeHash, buildDedupeHashPayload } from "./dedupe";

describe("dedupe hash", () => {
  it("builds stable payload", () => {
    expect(
      buildDedupeHashPayload(
        "tbank",
        "2026-01-01T00:00:00.000Z",
        -120.5,
        "RUB",
        "Coffee Shop",
        "1234",
      ),
    ).toBe("tbank|2026-01-01T00:00:00.000Z|-120.5|RUB|Coffee Shop|1234");
  });

  it("produces deterministic hash", async () => {
    const a = await buildDedupeHash(
      "tbank",
      "2026-01-01T00:00:00.000Z",
      -120.5,
      "RUB",
      "Coffee Shop",
      "1234",
    );
    const b = await buildDedupeHash(
      "tbank",
      "2026-01-01T00:00:00.000Z",
      -120.5,
      "RUB",
      "Coffee Shop",
      "1234",
    );

    expect(a).toHaveLength(64);
    expect(a).toBe(b);
  });

  it("changes hash when input changes", async () => {
    const a = await buildDedupeHash(
      "tbank",
      "2026-01-01T00:00:00.000Z",
      -120.5,
      "RUB",
      "Coffee Shop",
      "1234",
    );
    const b = await buildDedupeHash(
      "tbank",
      "2026-01-01T00:00:00.000Z",
      -121.5,
      "RUB",
      "Coffee Shop",
      "1234",
    );
    expect(a).not.toBe(b);
  });
});
