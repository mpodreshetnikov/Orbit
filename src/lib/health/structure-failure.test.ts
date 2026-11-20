import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CLIENT_STRUCTURE_CAUSES,
  durableClientStructureFailure,
  formatClientStructureFailure,
  MAX_STRUCTURE_ERROR_LENGTH,
  parseStructureFailureCause,
  SERVER_STRUCTURE_CAUSES,
  translateStructureFailure,
} from "./structure-failure";

const SERVER_FILE = join(process.cwd(), "supabase/functions/health-structure/failure.ts");

describe("the two halves of the structuring failure vocabulary", () => {
  // The edge function is Deno and is deployed from its own directory, so neither side can import
  // the other. A code the server writes and this side does not know renders as raw English, which
  // is the defect this whole vocabulary exists to remove -- so the drift is caught here instead.
  it("declares the same server causes on both sides", () => {
    const source = readFileSync(SERVER_FILE, "utf8");
    const union = source.slice(
      source.indexOf("export type StructureFailureCause ="),
      source.indexOf('| "internal";') + '| "internal";'.length,
    );
    const declared = [...union.matchAll(/\|\s*"([a-z_]+)"/g)].map((match) => match[1]);

    expect(declared).toEqual([...SERVER_STRUCTURE_CAUSES]);
  });

  it("has a translation for every cause either side can write", () => {
    const en = JSON.parse(readFileSync(join(process.cwd(), "src/messages/en.json"), "utf8"));
    const ru = JSON.parse(readFileSync(join(process.cwd(), "src/messages/ru.json"), "utf8"));

    for (const cause of [...SERVER_STRUCTURE_CAUSES, ...CLIENT_STRUCTURE_CAUSES]) {
      expect(en.processing.structureCause[cause], `en: ${cause}`).toBeTruthy();
      expect(ru.processing.structureCause[cause], `ru: ${cause}`).toBeTruthy();
    }
  });
});

describe("parseStructureFailureCause", () => {
  it("reads the cause the server wrote", () => {
    expect(
      parseStructureFailureCause(
        "structure_cause:provider_auth the structuring service rejected this deployment's credentials",
      ),
    ).toBe("provider_auth");
  });

  it("reads a cause with no detail after it", () => {
    expect(parseStructureFailureCause("structure_cause:internal")).toBe("internal");
  });

  it("returns null for a row written before the vocabulary existed", () => {
    expect(parseStructureFailureCause("OpenRouter request failed: 404")).toBeNull();
    expect(parseStructureFailureCause("structure_cause:something_else and more")).toBeNull();
    expect(parseStructureFailureCause(null)).toBeNull();
  });
});

describe("formatClientStructureFailure", () => {
  it("leads with the code, so truncation can only cost detail", () => {
    const message = formatClientStructureFailure("service_unreachable", "x".repeat(2000));
    expect(message.length).toBe(MAX_STRUCTURE_ERROR_LENGTH);
    expect(parseStructureFailureCause(message)).toBe("service_unreachable");
  });

  it("embeds the fixed English summary for each client cause", () => {
    expect(formatClientStructureFailure("service_unreachable")).toContain(
      "the structuring service could not be reached",
    );
    expect(formatClientStructureFailure("not_authenticated")).toContain(
      "the session is not signed in",
    );
  });
});

describe("durableClientStructureFailure", () => {
  it("keeps an already-classified server message", () => {
    const classified =
      "structure_cause:provider_auth the structuring service rejected this deployment's credentials";
    expect(durableClientStructureFailure(new Error(classified))).toBe(classified);
  });

  it("classifies a missing session", () => {
    expect(durableClientStructureFailure(new Error("Not authenticated"))).toBe(
      "structure_cause:not_authenticated the session is not signed in",
    );
  });

  it("classifies transport failures as service_unreachable", () => {
    expect(durableClientStructureFailure(new TypeError("Failed to fetch"))).toContain(
      "structure_cause:service_unreachable",
    );
  });

  it("preserves unclassified server explanations", () => {
    expect(durableClientStructureFailure(new Error("OPENROUTER_API_KEY is required"))).toBe(
      "OPENROUTER_API_KEY is required",
    );
  });
});

describe("translateStructureFailure", () => {
  const t = (key: string) => `translated:${key}`;

  it("translates a classified failure", () => {
    expect(
      translateStructureFailure(
        "structure_cause:provider_no_endpoint the structuring service could not route the request as configured",
        t,
      ),
    ).toBe("translated:processing.structureCause.provider_no_endpoint");
  });

  it("shows an older row as it stands rather than nothing at all", () => {
    expect(translateStructureFailure("OpenRouter request failed: 404", t)).toBe(
      "OpenRouter request failed: 404",
    );
  });

  it("falls back when there is no message", () => {
    expect(translateStructureFailure(null, t)).toBe("translated:processing.structureFailed");
  });
});
