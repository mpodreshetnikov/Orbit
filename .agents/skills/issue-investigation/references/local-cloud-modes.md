# Local And Cloud Modes

Use this file to choose an investigation execution path before running queries.

## 1. Detect Available Paths

- Local MCP path exists when tools prefixed with `mcp__grafana-local__` are available.
- Cloud MCP path exists when tools prefixed with `mcp__grafana-cloud__` are available.
- If both exist, pick the environment that matches the incident first, then compare with the other only if needed.
- If neither exists, use Grafana UI/API fallback.

## 2. Local MCP Path

1. List datasources and map UIDs for Prometheus, Loki, and Tempo.
2. Discover label names and values before writing narrow queries.
3. Run metrics, then logs, then traces.
4. Keep explicit UTC time bounds across every query.

Common local tool families:
- Datasource and dashboard discovery
- Prometheus query execution
- Loki log and pattern analysis
- Tempo TraceQL search and trace retrieval

## 3. Cloud MCP Path

1. List cloud datasources first; do not assume local UID names match cloud UIDs.
2. Apply environment/tenant filters early (`env`, `cluster`, `namespace`, tenant labels).
3. Run the same metrics -> logs -> traces sequence.
4. Keep the same UTC window for all signal types.

## 4. UI/API Fallback (No MCP)

1. Open Grafana Explore and set absolute UTC window.
2. Run PromQL to confirm onset and impact.
3. Run LogQL in the same window and extract top error signatures.
4. Run TraceQL for the affected service and inspect slow/error traces.
5. Collect links, trace IDs, and screenshots for incident notes.

## 5. Practical Limits

- Tempo metrics/traces APIs may reject long windows depending on configuration.
- If a query fails due duration limits, split the window into chunks (for example 2-3 hours), then compare results by chunk.
