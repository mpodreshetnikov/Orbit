import { assertEquals } from "std/assert/assert-equals";
import {
  findBodySiteCatalogEntry,
  findCatalogEntry,
  findFindingTypeCatalogEntry,
} from "./catalog.ts";

Deno.test("findCatalogEntry returns matching observation by obs_code", () => {
  const catalog = [{ obs_code: "HB", name: "Hemoglobin" }];
  assertEquals(findCatalogEntry("HB", catalog), catalog[0]);
  assertEquals(findCatalogEntry("GLU", catalog), null);
  assertEquals(findCatalogEntry(null, catalog), null);
});

Deno.test("findFindingTypeCatalogEntry returns matching finding by finding_code", () => {
  const catalog = [{ finding_code: "FIND-1", name: "Nodule" }];
  assertEquals(findFindingTypeCatalogEntry("FIND-1", catalog), catalog[0]);
  assertEquals(findFindingTypeCatalogEntry(null, catalog), null);
});

Deno.test("findBodySiteCatalogEntry returns matching site by site_code", () => {
  const catalog = [{ site_code: "HEAD", name: "Head" }];
  assertEquals(findBodySiteCatalogEntry("HEAD", catalog), catalog[0]);
  assertEquals(findBodySiteCatalogEntry("CHEST", catalog), null);
  assertEquals(findBodySiteCatalogEntry(null, catalog), null);
});
