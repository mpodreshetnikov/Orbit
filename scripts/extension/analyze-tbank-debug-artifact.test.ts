import { describe, expect, it } from "vitest";
import { analyzeArtifactBundle } from "./analyze-tbank-debug-artifact";

interface MutableArtifact {
  metadata: {
    window_from: string;
  };
  parse_output: {
    rows: Array<Record<string, unknown>>;
    parsedThroughAt: string;
    windowTo: string;
    debug: {
      extraction_method: string;
      fallback_used: boolean;
      discovered_endpoints: Record<string, string>;
      response_status_histogram: Record<string, number>;
      mapping_drop_counts: Record<string, number>;
      api_operation_count: number;
      mapped_row_count: number;
    };
  };
  debug_run: {
    run: {
      status: string;
      error_message: string | null;
    };
    events: Array<Record<string, unknown>>;
  };
}

function createBaseArtifact(): MutableArtifact {
  return {
    metadata: {
      window_from: "2026-03-01T00:00:00.000Z",
    },
    parse_output: {
      rows: [
        {
          posted_at: "2026-03-05T00:00:00.000Z",
          line_items: [{ title: "Item", amount: -10 }],
        },
      ],
      parsedThroughAt: "2026-02-28T00:00:00.000Z",
      windowTo: "2026-03-05T00:00:00.000Z",
      debug: {
        extraction_method: "api",
        fallback_used: false,
        discovered_endpoints: {
          operations_api: "https://www.tbank.ru/api/common/v1/operations?sessionid=<redacted>",
        },
        response_status_histogram: {},
        mapping_drop_counts: {
          invalid_record: 0,
          invalid_operation: 0,
          missing_time_or_amount: 0,
        },
        api_operation_count: 1,
        mapped_row_count: 1,
      },
    },
    debug_run: {
      run: {
        status: "ok",
        error_message: null,
      },
      events: [],
    },
  };
}

function asArtifact(artifact: MutableArtifact): Record<string, unknown> {
  return artifact as unknown as Record<string, unknown>;
}

describe("analyze-tbank-debug-artifact", () => {
  it("passes for healthy API artifact", () => {
    const diagnostics = analyzeArtifactBundle(
      asArtifact(createBaseArtifact()),
      ".tmp/test-artifact",
    );
    expect(diagnostics.passed).toBe(true);
    expect(diagnostics.categories).toEqual([]);
  });

  it("marks auth-blocked runs", () => {
    const artifact = createBaseArtifact();
    artifact.debug_run.run.error_message =
      "T-Bank session is not authorized. Sign in and retry import.";
    const diagnostics = analyzeArtifactBundle(asArtifact(artifact), ".tmp/test-artifact");
    expect(diagnostics.categories).toContain("AUTH_BLOCKED");
    expect(diagnostics.passed).toBe(false);
  });

  it("marks unauthorized edge failures as auth-blocked", () => {
    const artifact = createBaseArtifact();
    artifact.debug_run.run.error_message =
      "Edge request failed (apply_rows) status 401: Unauthorized";
    const diagnostics = analyzeArtifactBundle(asArtifact(artifact), ".tmp/test-artifact");
    expect(diagnostics.categories).toContain("AUTH_BLOCKED");
    expect(diagnostics.passed).toBe(false);
  });

  it("marks API discovery missed when DOM fallback has no endpoint", () => {
    const artifact = createBaseArtifact();
    artifact.parse_output.debug.extraction_method = "dom";
    artifact.parse_output.debug.fallback_used = true;
    artifact.parse_output.debug.discovered_endpoints = {};
    const diagnostics = analyzeArtifactBundle(asArtifact(artifact), ".tmp/test-artifact");
    expect(diagnostics.categories).toContain("API_DISCOVERY_MISSED");
  });

  it("marks API status failures", () => {
    const artifact = createBaseArtifact();
    artifact.parse_output.debug.response_status_histogram = {
      "500": 2,
    };
    const diagnostics = analyzeArtifactBundle(asArtifact(artifact), ".tmp/test-artifact");
    expect(diagnostics.categories).toContain("API_4XX_5XX");
  });

  it("marks DOM selector drift for empty DOM fallback", () => {
    const artifact = createBaseArtifact();
    artifact.parse_output.rows = [];
    artifact.parse_output.debug.extraction_method = "dom";
    artifact.parse_output.debug.fallback_used = true;
    artifact.parse_output.debug.discovered_endpoints = {};
    const diagnostics = analyzeArtifactBundle(asArtifact(artifact), ".tmp/test-artifact");
    expect(diagnostics.categories).toContain("DOM_SELECTOR_DRIFT");
  });

  it("marks mapping drops", () => {
    const artifact = createBaseArtifact();
    artifact.parse_output.debug.mapping_drop_counts = {
      invalid_record: 1,
      invalid_operation: 0,
      missing_time_or_amount: 0,
    };
    const diagnostics = analyzeArtifactBundle(asArtifact(artifact), ".tmp/test-artifact");
    expect(diagnostics.categories).toContain("MAPPING_DROP");
  });
});
