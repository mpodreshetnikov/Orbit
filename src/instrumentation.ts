export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startNodeOtel } = await import("@/lib/observability/server-otel");
    await startNodeOtel();
  }
}
