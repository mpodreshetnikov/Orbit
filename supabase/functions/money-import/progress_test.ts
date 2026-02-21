import { assertEquals } from "std/assert/assert-equals";
import { computeProgressPercent } from "./progress.ts";

Deno.test("computeProgressPercent returns null for missing inputs", () => {
  assertEquals(
    computeProgressPercent(null, "2026-01-10T00:00:00.000Z", "2026-01-05T00:00:00.000Z"),
    null,
  );
});

Deno.test("computeProgressPercent computes bounded percentage", () => {
  assertEquals(
    computeProgressPercent(
      "2026-01-01T00:00:00.000Z",
      "2026-01-11T00:00:00.000Z",
      "2026-01-06T00:00:00.000Z",
    ),
    50,
  );
});

Deno.test("computeProgressPercent handles inverted windows", () => {
  assertEquals(
    computeProgressPercent(
      "2026-01-10T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    ),
    100,
  );
});
