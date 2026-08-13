# Issue RCA Report Template

Use this structure for final investigation output.

```text
Issue scope
- Environment: <local|cloud>
- Service(s): <service list>
- Time window (UTC): <start> to <end>
- Trigger context: <alert|user report|test failure|post-deploy check>

Impact summary
- User/system impact: <brief impact>
- Blast radius: <single service | multi-service | global>

Findings
- Metrics: <what changed, when it started, how severe>
- Logs: <top error signatures + first/peak timestamps>
- Traces: <key trace IDs + slow/error spans and owning service>

Most likely explanation
- Hypothesis: <one sentence>
- Why this is likely: <cross-signal evidence>
- Alternative considered and rejected: <brief>

Bug-specific details (if applicable)
- Repro path: <steps or request/job pattern>
- Fault signature: <error_code/exception/invalid state>
- Suspected change point: <release/build/flag/config>

Confidence and gaps
- Confidence: <high|medium|low>
- Unknowns: <what is still missing>

Immediate next actions
1. <mitigation or rollback/check>
2. <verification query or dashboard>
3. <owner and follow-up task>
```
