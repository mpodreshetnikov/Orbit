# Tech Debt Tracker

| Date       | Area               | Debt                                                                                       | Owner | Exit Criteria                                                                                                                                   | Status   |
| ---------- | ------------------ | ------------------------------------------------------------------------------------------ | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 2026-02-21 | Coverage depth     | Runtime coverage is now visible per surface, but depth remains low in web and DB surfaces. | TBD   | `coverage/combined-summary.json` shows sustained improvement and `db-coverage-summary.json` mapping > 50%/50%                                   | Open     |
| 2026-02-21 | Supabase functions | All 5 live functions have handler tests, but tests mostly cover fast-fail/guard paths.     | Codex | Handler/service/adaptor suites cover success + negative branches with mocked internet calls and per-function Deno coverage >=75% lines/branches | Resolved |
