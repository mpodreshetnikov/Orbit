import { context, SpanStatusCode, trace } from "@opentelemetry/api";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";
import {
  SEMRESATTRS_DEPLOYMENT_ENVIRONMENT,
  SEMRESATTRS_SERVICE_NAME,
  SEMRESATTRS_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import {
  resolveObservabilityIdentity,
  resolveOtlpHeaders,
  resolveOtlpTracesEndpoint,
} from "./config";

declare global {
  var __orbitNodeOtelSdk: NodeSDK | undefined;
  var __orbitNodeOtelStarted: boolean | undefined;
}

function createSdk(): NodeSDK {
  const identity = resolveObservabilityIdentity();
  const endpoint = resolveOtlpTracesEndpoint();

  return new NodeSDK({
    traceExporter: new OTLPTraceExporter({
      url: endpoint,
      headers: resolveOtlpHeaders(),
    }),
    instrumentations: [
      getNodeAutoInstrumentations({
        "@opentelemetry/instrumentation-winston": {
          enabled: false,
        },
      }),
    ],
    resource: resourceFromAttributes({
      [SEMRESATTRS_SERVICE_NAME]: identity.app,
      [SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]: identity.env,
      [SEMRESATTRS_SERVICE_VERSION]: identity.release,
    }),
  });
}

export async function startNodeOtel(): Promise<void> {
  if (globalThis.__orbitNodeOtelStarted) {
    return;
  }

  if (!globalThis.__orbitNodeOtelSdk) {
    globalThis.__orbitNodeOtelSdk = createSdk();
  }

  await globalThis.__orbitNodeOtelSdk.start();
  globalThis.__orbitNodeOtelStarted = true;
}

export async function shutdownNodeOtel(): Promise<void> {
  if (!globalThis.__orbitNodeOtelSdk || !globalThis.__orbitNodeOtelStarted) {
    return;
  }

  await globalThis.__orbitNodeOtelSdk.shutdown();
  globalThis.__orbitNodeOtelStarted = false;
}

export function getActiveTraceContext(): { trace_id?: string; span_id?: string } {
  const activeSpan = trace.getSpan(context.active());
  if (!activeSpan) {
    return {};
  }

  const spanContext = activeSpan.spanContext();
  return {
    trace_id: spanContext.traceId,
    span_id: spanContext.spanId,
  };
}

export async function withServerSpan<T>(name: string, run: () => Promise<T>): Promise<T> {
  const tracer = trace.getTracer("orbit.server");

  return tracer.startActiveSpan(name, async (span) => {
    try {
      const result = await run();
      span.setStatus({ code: SpanStatusCode.OK });
      span.end();
      return result;
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : "unknown error",
      });
      span.end();
      throw error;
    }
  });
}
