import { describe, expect, it } from "vitest";
import { addSynonym, matchesCatalogEntry, parentCandidates } from "./clinical-catalog";
import type { BodySiteCatalog } from "./finding";

const names = { name_ru: "Полип", name_en: "Polyp", synonyms_ru: ["нарост"], synonyms_en: [] };

function site(id: string, parent: string | null = null): BodySiteCatalog {
  return {
    id,
    site_code: id,
    name_ru: id,
    name_en: id,
    parent_site_code: parent,
    synonyms_ru: [],
    synonyms_en: [],
    notes: null,
    created_at: "",
    updated_at: "",
  };
}

describe("matchesCatalogEntry", () => {
  it("finds by code, names and synonyms, ignoring case", () => {
    expect(matchesCatalogEntry("polyp", names, "")).toBe(true);
    expect(matchesCatalogEntry("polyp", names, "POL")).toBe(true);
    expect(matchesCatalogEntry("x", names, "нарос")).toBe(true);
    expect(matchesCatalogEntry("x", names, "киста")).toBe(false);
  });
});

describe("addSynonym", () => {
  it("adds a new synonym lower-cased, and refuses an empty or repeated one", () => {
    expect(addSynonym(["a"], " Нарост ")).toEqual(["a", "нарост"]);
    expect(addSynonym(["a"], "A")).toBeNull();
    expect(addSynonym([], "  ")).toBeNull();
  });
});

describe("parentCandidates", () => {
  const all = [
    site("abdomen"),
    site("kidney", "abdomen"),
    site("kidney_left", "kidney"),
    site("orphan", "gone"),
  ];

  it("offers every site for a new one", () => {
    expect(parentCandidates(all, null)).toHaveLength(4);
  });

  it("leaves out the site itself and everything under it", () => {
    expect(parentCandidates(all, all[1]).map((one) => one.id)).toEqual(["abdomen", "orphan"]);
  });
});
