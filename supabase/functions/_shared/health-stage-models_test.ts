import { assertEquals } from "std/assert/assert-equals";
import { DEFAULT_HEALTH_STAGE_MODELS } from "./health-stage-models.ts";

// The ids themselves, pinned. `T-260903-oy7` measured this configuration over fourteen live
// passes and the owner accepted it; a change to one of these is a change to what production runs,
// so it should have to be made deliberately here rather than arriving as a diff nobody read.
Deno.test("the per-stage defaults are the measured configuration", () => {
  assertEquals(DEFAULT_HEALTH_STAGE_MODELS.classify, "google/gemini-2.5-flash");
  assertEquals(DEFAULT_HEALTH_STAGE_MODELS.extract, "google/gemini-2.5-flash");
  assertEquals(DEFAULT_HEALTH_STAGE_MODELS.reconcile, "openai/gpt-5.2");
});

// The point of the configuration is that reconcile is not the same model as the other two. If a
// future edit collapses them onto one id, that is the saving `health-stage-models.ts` says not to
// take — 1 of 8 measured passes wrongfully resolved on the reconcile model against 4 of 6 on the
// cheaper one — and it should fail here rather than in a patient's record.
Deno.test("reconcile is held apart from the cheap stages", () => {
  // Widened, because `as const` makes the literal types disjoint and the compiler would settle the
  // comparison itself rather than the test settling it.
  const models: Record<string, string> = DEFAULT_HEALTH_STAGE_MODELS;
  assertEquals(models.classify, models.extract);
  assertEquals(models.reconcile !== models.extract, true);
});
