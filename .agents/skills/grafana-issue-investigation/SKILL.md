---
name: grafana-issue-investigation
description: Investigate incidents, bugs, and regressions by correlating Grafana structured logs, traces, and metrics across local and cloud environments. Use when triaging reliability issues, debugging functional defects, performing root cause analysis after failures, validating fixes, or analyzing post-deploy behavior changes.
---

# Grafana Issue Investigation

Investigate issues with an evidence-first flow that correlates structured logs, traces, and metrics.

## Workflow

1. Scope the incident
- Confirm service, environment, and an explicit UTC time window.
- Start with `now-30m` for active issues and expand only if needed.
- If tool limits reject long windows (for example, some Tempo metrics calls), split into smaller chunks and aggregate findings.

2. Choose local or cloud execution path
- Follow `references/local-cloud-modes.md`.
- Prefer MCP paths when available for repeatability and auditable query steps.

3. Choose primary signal based on symptom
- For reliability symptoms (errors, latency, saturation), start with metrics.
- For defect symptoms (wrong behavior, bad data, failed workflow), start with structured logs.
- Keep one shared UTC time window and one service scope across all signals.

4. Correlate with structured logs
- Query the same service and incident window.
- Parse log fields (`trace_id`, `request_id`, `user_id`, `error_code`, `feature_flag`, `build_sha`) before filtering.
- Identify repeated signatures and first-seen timestamps.
- Save at least one representative log line with timestamp.

5. Deep-dive traces
- Search for error traces, then slow traces.
- Inspect suspect traces and identify the slowest/error spans and owning service.
- Save 2-3 trace IDs as concrete evidence.

6. Form and test a hypothesis
- Build one explanation that ties a metric anomaly, log signature, and trace behavior.
- Try to disprove the closest alternative explanation.

7. Report with confidence and gaps
- Use `references/report-template.md`.
- Include findings, confidence level, unknowns, and immediate next action.

## Bug RCA Mode (Structured Logs First)

1. Start from a concrete failure example
- Use one failing request, user action, or job run as the anchor case.

2. Parse fields and group failures
- Group by `error_code`, endpoint, feature flag, or build/release to find the dominant failure pattern.

3. Correlate to traces
- Use `trace_id` or request correlation IDs from logs to inspect span-level behavior.
- Confirm the exact component and operation where behavior diverges.

4. Confirm impact in metrics
- Quantify how often the bug path occurs and whether impact is rising.
- Compare failing path rate before and after deploy if release labels exist.

5. Produce RCA statement
- State trigger, faulty component, and observed impact.
- Separate confirmed cause from plausible but unverified factors.

## Guardrails

- State absolute UTC timestamps in all findings.
- Do not claim root cause without cross-signal evidence.
- Prefer parsed structured fields over raw free-text grep when both are available.
- Verify label keys and values before declaring "no data."
- If cloud MCP is unavailable, continue with the UI/API fallback from `references/local-cloud-modes.md`.

## References

- `references/local-cloud-modes.md`: mode selection and tool mapping.
- `references/query-recipes.md`: discovery-first PromQL/LogQL/TraceQL patterns for incidents and bug RCA.
- `references/report-template.md`: concise incident write-up template.
