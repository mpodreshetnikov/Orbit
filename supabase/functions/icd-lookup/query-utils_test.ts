import { assertEquals } from "std/assert/assert-equals";
import { buildIcd10CandidateCodes, looksLikeIcdCodeQuery } from "./query-utils.ts";

Deno.test("looksLikeIcdCodeQuery detects code-like input", () => {
  assertEquals(looksLikeIcdCodeQuery("D50.9"), true);
  assertEquals(looksLikeIcdCodeQuery("h52"), true);
  assertEquals(looksLikeIcdCodeQuery("headache"), false);
});

Deno.test("buildIcd10CandidateCodes builds specific code neighbors", () => {
  assertEquals(buildIcd10CandidateCodes("H52.3", 10), ["H52.1", "H52.2", "H52.3", "H52.4", "H52.5", "H52.6", "H52.7", "H52.8"]);
});

Deno.test("buildIcd10CandidateCodes builds category and prefix candidates", () => {
  assertEquals(buildIcd10CandidateCodes("E11", 5), ["E11", "E11.0", "E11.1", "E11.2", "E11.3"]);
  assertEquals(buildIcd10CandidateCodes("A", 4), ["A00", "A01", "A10", "A02"]);
});
