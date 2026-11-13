import { assertEquals } from "std/assert/assert-equals";
import {
  decideJevCategoryApplication,
  DEFAULT_JEV_NOUL_THRESHOLD,
  DEFAULT_JEV_PROBABILITY_THRESHOLD,
} from "./jev-confidence.ts";

Deno.test("decideJevCategoryApplication applies at threshold boundary", () => {
  const decision = decideJevCategoryApplication({
    choice: "cat-food",
    choiceProbability: DEFAULT_JEV_PROBABILITY_THRESHOLD,
    noul: DEFAULT_JEV_NOUL_THRESHOLD,
  });
  assertEquals(decision.apply, true);
});

Deno.test("decideJevCategoryApplication abstains below probability threshold", () => {
  const decision = decideJevCategoryApplication({
    choice: "cat-food",
    choiceProbability: DEFAULT_JEV_PROBABILITY_THRESHOLD - 0.01,
    noul: 0.9,
  });
  assertEquals(decision.apply, false);
  assertEquals(decision.reason.includes("probability"), true);
});

Deno.test("decideJevCategoryApplication abstains below noul threshold", () => {
  const decision = decideJevCategoryApplication({
    choice: "cat-food",
    choiceProbability: 0.99,
    noul: DEFAULT_JEV_NOUL_THRESHOLD - 0.01,
  });
  assertEquals(decision.apply, false);
  assertEquals(decision.reason.includes("Noul"), true);
});

Deno.test("decideJevCategoryApplication abstains when choice missing", () => {
  const decision = decideJevCategoryApplication({
    choice: null,
    choiceProbability: 0.99,
    noul: 0.99,
  });
  assertEquals(decision.apply, false);
});

Deno.test("decideJevCategoryApplication applies above thresholds", () => {
  const decision = decideJevCategoryApplication({
    choice: "cat-food",
    choiceProbability: DEFAULT_JEV_PROBABILITY_THRESHOLD + 0.01,
    noul: DEFAULT_JEV_NOUL_THRESHOLD + 0.01,
  });
  assertEquals(decision.apply, true);
});
