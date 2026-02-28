import { afterEach, describe, expect, it } from "vitest";

function setEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}

describe("observability config", () => {
  const envSnapshot = { ...process.env };

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in envSnapshot)) {
        delete process.env[key];
      }
    }
    for (const [key, value] of Object.entries(envSnapshot)) {
      setEnv(key, value);
    }
  });

  it("resolves local defaults when mode is not cloud", async () => {
    setEnv("OBS_EXPORTER_MODE", undefined);
    setEnv("OBS_OTLP_ENDPOINT", undefined);
    setEnv("OBS_LOCAL_OTLP_HTTP_ENDPOINT", undefined);
    setEnv("OBS_OTLP_HEADERS", undefined);
    setEnv("OBS_APP", undefined);
    setEnv("OBS_ENV", undefined);
    setEnv("OBS_RELEASE", undefined);
    setEnv("NODE_ENV", "test");

    const mod = await import("./config");

    expect(mod.resolveOtlpLogsEndpoint()).toBe("http://127.0.0.1:4318/v1/logs");
    expect(mod.resolveOtlpTracesEndpoint()).toBe("http://127.0.0.1:4318/v1/traces");
    expect(mod.resolveOtlpHeaders()).toEqual({});
    expect(mod.resolveObservabilityIdentity()).toEqual({
      app: "orbit",
      env: "local",
      release: "dev-local",
    });
  });

  it("normalizes endpoint paths and parses headers in cloud mode", async () => {
    setEnv("OBS_EXPORTER_MODE", "cloud");
    setEnv("OBS_OTLP_ENDPOINT", "https://base.example");
    setEnv("OBS_OTLP_LOGS_ENDPOINT", "https://logs.example/custom");
    setEnv("OBS_OTLP_TRACES_ENDPOINT", "https://traces.example/");
    setEnv("OBS_OTLP_HEADERS", "x-token=abc, invalid, x-empty=, x-common=1");
    setEnv("OBS_GRAFANA_CLOUD_OTLP_HEADERS", "x-cloud=ok, x-common=2");
    setEnv("OBS_APP", "web");
    setEnv("OBS_ENV", "stage");
    setEnv("OBS_RELEASE", "2026.02.28");
    setEnv("NODE_ENV", "production");

    const mod = await import("./config");

    expect(mod.resolveOtlpLogsEndpoint()).toBe("https://logs.example/custom/v1/logs");
    expect(mod.resolveOtlpTracesEndpoint()).toBe("https://traces.example/v1/traces");
    expect(mod.resolveOtlpHeaders()).toEqual({
      "x-token": "abc",
      "x-common": "2",
      "x-cloud": "ok",
    });
    expect(mod.resolveObservabilityIdentity()).toEqual({
      app: "web",
      env: "stage",
      release: "2026.02.28",
    });
  });

  it("uses shared endpoint fallback and keeps existing otlp paths unchanged", async () => {
    setEnv("OBS_EXPORTER_MODE", "cloud");
    setEnv("OBS_OTLP_LOGS_ENDPOINT", undefined);
    setEnv("OBS_OTLP_TRACES_ENDPOINT", undefined);
    setEnv("OBS_OTLP_ENDPOINT", "https://collector.example/v1/logs");

    const mod = await import("./config");

    expect(mod.resolveOtlpLogsEndpoint()).toBe("https://collector.example/v1/logs");
    expect(mod.resolveOtlpTracesEndpoint()).toBe("https://collector.example/v1/logs/v1/traces");
  });

  it("uses prod env fallback when node env is production and OBS_ENV is unset", async () => {
    setEnv("OBS_ENV", undefined);
    setEnv("NODE_ENV", "production");
    const mod = await import("./config");
    expect(mod.resolveObservabilityIdentity().env).toBe("prod");
  });
});
