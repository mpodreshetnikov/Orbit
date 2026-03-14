export type AppEnvironmentKind = "development" | "production";

declare global {
  interface Window {
    __ORBIT_APP_ENV_KIND__?: AppEnvironmentKind;
  }
}

export function getAppEnvironmentKind(): AppEnvironmentKind {
  const forcedKind = process.env.NEXT_PUBLIC_APP_ENV_KIND?.trim().toLowerCase();
  if (forcedKind === "development" || forcedKind === "production") {
    return forcedKind;
  }

  if (typeof window === "undefined") return "production";

  const windowKind = window.__ORBIT_APP_ENV_KIND__;
  if (windowKind === "development" || windowKind === "production") {
    return windowKind;
  }

  const hostname = window.location.hostname.trim().toLowerCase();
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return "development";
  }

  return "production";
}
