# Query Recipes

Use discovery-first queries. Metric and label names vary across environments.

## 1. Metrics Discovery (Prometheus)

1. Discover candidate metrics first (regex around `http`, `request`, `duration`, `latency`, `error`).
2. Discover label values for the selected metric (`service`, `job`, `namespace`, `env`, etc.).
3. Build scoped RED queries.

Example RED patterns (adapt labels and metric names):

```promql
# Request rate
sum(rate(http_server_request_duration_seconds_count{service="$service"}[5m]))
```

```promql
# Error rate (%)
100 *
sum(rate(http_server_request_duration_seconds_count{service="$service",status_code=~"5.."}[5m])) /
sum(rate(http_server_request_duration_seconds_count{service="$service"}[5m]))
```

```promql
# P95 latency
histogram_quantile(
  0.95,
  sum(rate(http_server_request_duration_seconds_bucket{service="$service"}[5m])) by (le)
)
```

## 2. Structured Logs (Loki / LogQL)

Start broad, parse fields, then narrow.

```logql
{service_name="$service", env="$env"} |= "error"
```

```logql
{service_name="$service", env="$env"} | json | level=~"error|fatal"
```

```logql
sum by (level) (count_over_time({service_name="$service", env="$env"} | json [5m]))
```

Bug RCA examples (adapt field names):

```logql
{service_name="$service", env="$env"} | json | error_code!=""
```

```logql
sum by (error_code) (
  count_over_time({service_name="$service", env="$env"} | json | error_code!="" [5m])
)
```

```logql
{service_name="$service", env="$env"} | json | request_id="$request_id"
```

```logql
{service_name="$service", env="$env"} | json | trace_id!="" | line_format "{{.trace_id}} {{.error_code}} {{.message}}"
```

Orbit frontend/edge correlation starters:

```logql
{service_name="orbit"} | json | message=~"edge_function_request_started|edge_function_request_failed|supabase_rpc_started|supabase_rpc_failed"
```

```logql
{service_name="supabase-function"} | json | trace_id="$trace_id" | line_format "{{.component}} {{.message}} {{.request_id}}"
```

Pattern analysis input must be a selector-only stream:

```logql
{service_name="$service", env="$env"}
```

## 3. Traces (Tempo / TraceQL)

Use service-scoped search first:

```traceql
{ resource.service.name = "$service" }
```

Error-focused:

```traceql
{ resource.service.name = "$service" && status = error }
```

Latency-focused:

```traceql
{ resource.service.name = "$service" && duration > 500ms }
```

Orbit span-name filters:

```traceql
{ resource.service.name = "orbit" && name =~ "web\\.supabase\\.rpc\\..*" }
```

```traceql
{ resource.service.name = "orbit" && name =~ "web\\.edge_function\\..*" }
```

```traceql
{ resource.service.name = "supabase-function" && name =~ "edge\\..*\\.request" }
```

Bug RCA focus:
- If structured logs include `trace_id`, inspect those traces first before running broad TraceQL searches.
- If direct trace lookup tooling exists, fetch by ID; otherwise search the same service/window and match operation names and timestamps.

Critical detail:
- If the backend rejects long ranges, split the incident window into smaller chunks and compare counts and top offenders per chunk.

## 4. Correlation Checklist

- Match one metric onset timestamp to one or more log signatures.
- Find traces in the same interval and confirm the same service/component appears in slow/error spans.
- For bug RCA, link at least one structured log field (`error_code`, `request_id`, `trace_id`) to a concrete trace or metric change.
- Keep at least one saved query per signal so the investigation is reproducible.
