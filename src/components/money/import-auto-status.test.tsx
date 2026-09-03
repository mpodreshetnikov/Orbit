// @vitest-environment jsdom

import { render, screen, within } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";
import { MoneyImportAutoStatus, readExtensionAutoStatus } from "./import-auto-status";

const t = (key: string, values?: Record<string, string | number>) =>
  values ? `${key} ${Object.values(values).join(" ")}` : key;
const labels = { tbank_web: "T-Bank", alfa_web: "Alfa-Bank" };
const grant = {
  person_id: "person-1",
  allowed_sources: ["tbank_web", "alfa_web"],
  received_at: "2026-09-03T05:00:00.000Z",
};

describe("readExtensionAutoStatus", () => {
  it("refuses a reply that is not ok, and reads a well-formed one", () => {
    expect(readExtensionAutoStatus({ ok: false })).toBeNull();
    expect(
      readExtensionAutoStatus({
        ok: true,
        grant,
        sources: [
          {
            source_id: "tbank_web",
            last_run_at: "2026-09-03T05:02:00.000Z",
            last_result: "error",
            consecutive_failures: 1,
            last_error: "T-Bank did not stay on the operations page",
            next_run: { kind: "after", at: "2026-09-04T01:02:00.000Z" },
            scheduled_at: null,
          },
          // Shapes it does not recognise fall back rather than throw.
          { source_id: "alfa_web", next_run: { kind: "sideways" }, consecutive_failures: "x" },
          "not a source",
        ],
      }),
    ).toEqual({
      grant,
      sources: [
        {
          source_id: "tbank_web",
          last_run_at: "2026-09-03T05:02:00.000Z",
          last_result: "error",
          consecutive_failures: 1,
          last_error: "T-Bank did not stay on the operations page",
          next_run: { kind: "after", at: "2026-09-04T01:02:00.000Z" },
          scheduled_at: null,
        },
        {
          source_id: "alfa_web",
          last_run_at: null,
          last_result: null,
          consecutive_failures: 0,
          last_error: null,
          next_run: { kind: "now" },
          scheduled_at: null,
        },
      ],
    });
  });
});

describe("MoneyImportAutoStatus", () => {
  it("says when the extension did not answer, and when it holds no key", () => {
    const { rerender } = render(
      <MoneyImportAutoStatus
        t={t}
        state="inactive"
        status={null}
        sourceLabels={labels}
        onRefresh={() => {}}
      />,
    );
    expect(screen.getByText("money.importAutoStatusExtensionInactive")).toBeInTheDocument();

    rerender(
      <MoneyImportAutoStatus
        t={t}
        state="ready"
        status={{ grant: null, sources: [] }}
        sourceLabels={labels}
        onRefresh={() => {}}
      />,
    );
    expect(screen.getByText("money.importAutoStatusNoGrant")).toBeInTheDocument();
  });

  it("tells, per source, what happened last and when the next run may start", () => {
    render(
      <MoneyImportAutoStatus
        t={t}
        state="ready"
        status={{
          grant,
          sources: [
            {
              source_id: "tbank_web",
              last_run_at: "2026-09-03T05:02:00.000Z",
              last_result: "error",
              consecutive_failures: 1,
              last_error: "T-Bank did not stay on the operations page",
              next_run: { kind: "after", at: "2026-09-04T01:02:00.000Z" },
              scheduled_at: null,
            },
            {
              source_id: "alfa_web",
              last_run_at: null,
              last_result: null,
              consecutive_failures: 0,
              last_error: null,
              next_run: { kind: "now" },
              scheduled_at: "2026-09-03T07:31:00.000Z",
            },
          ],
        }}
        sourceLabels={labels}
        onRefresh={() => {}}
      />,
    );

    expect(
      screen.getByText(/^money\.importAutoStatusGrantHeld .* T-Bank, Alfa-Bank$/),
    ).toBeInTheDocument();

    const tbank = screen.getByTestId("money-import-auto-status-tbank_web");
    expect(tbank).toHaveAttribute("data-tone", "error");
    expect(
      within(tbank).getByText(
        /^money\.importAutoStatusLastFailed .* T-Bank did not stay on the operations page$/,
      ),
    ).toBeInTheDocument();
    expect(within(tbank).getByText(/^money\.importAutoStatusNextAfter /)).toBeInTheDocument();

    const alfa = screen.getByTestId("money-import-auto-status-alfa_web");
    expect(alfa).toHaveAttribute("data-tone", "idle");
    expect(within(alfa).getByText("money.importAutoStatusNeverRan Alfa-Bank")).toBeInTheDocument();
    expect(within(alfa).getByText(/^money\.importAutoStatusScheduled /)).toBeInTheDocument();
  });

  it("says a source has stopped, and why", () => {
    render(
      <MoneyImportAutoStatus
        t={t}
        state="ready"
        status={{
          grant,
          sources: [
            {
              source_id: "tbank_web",
              last_run_at: "2026-09-03T05:02:00.000Z",
              last_result: "error",
              consecutive_failures: 3,
              last_error: "T-Bank session is not authorized. Sign in and retry import.",
              next_run: { kind: "stopped" },
              scheduled_at: null,
            },
          ],
        }}
        sourceLabels={labels}
        onRefresh={() => {}}
      />,
    );
    const tbank = screen.getByTestId("money-import-auto-status-tbank_web");
    expect(within(tbank).getByText("money.importAutoStatusStopped 3")).toBeInTheDocument();
    expect(within(tbank).getByText(/not authorized/)).toBeInTheDocument();
  });
});
