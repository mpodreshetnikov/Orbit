import type { CapacitorConfig } from "@capacitor/cli";

/**
 * The bundle identifier registered with the Apple Developer team.
 *
 * This is not a name that can be changed later on a whim. It is the root of the APNs topic Live
 * Activity pushes are addressed to, so changing it invalidates every push token already issued and
 * stops delivery without an error anyone sees. Change it only together with a plan for the tokens.
 */
export const IOS_BUNDLE_ID = "com.podreshetnikov.orbit";

/** The name under the icon on the Home Screen and in App Store Connect. */
export const IOS_APP_NAME = "Orbit";

/**
 * The origin the web view loads. The app ships no copy of the web app — it points at the deployed
 * site — so a web deploy reaches every installed app without a new signed build and a new upload.
 */
export const IOS_PRODUCTION_SERVER_URL = "https://private-orbit.vercel.app";

/**
 * Overrides the origin when the project is synced. Local testing against `dev-ready` sets it to the
 * machine's LAN address, because the phone cannot reach the Mac's `localhost`:
 *
 *     ORBIT_IOS_SERVER_URL=http://192.168.1.42:3000 npx cap sync ios
 *
 * It is read while the config is evaluated on the Mac, not on the device, so whatever it held at
 * sync time is baked into the project until the next sync.
 */
export const IOS_SERVER_URL_ENV = "ORBIT_IOS_SERVER_URL";

/**
 * The web assets Capacitor copies into the app bundle. `cap sync` refuses to run unless this
 * directory exists and holds an `index.html`, even though `server.url` means the bundle is never
 * what the user sees, so it holds exactly one page: the message shown when the origin above cannot
 * be reached.
 *
 * Deliberately not Next.js's `public/`. That directory is served by the web app, so an `index.html`
 * dropped there to satisfy Capacitor would become a real page on the public site.
 */
export const IOS_WEB_DIR = "native/ios/www";

/** The page inside `IOS_WEB_DIR` the web view falls back to when the origin is unreachable. */
export const IOS_ERROR_PAGE = "index.html";

/** Identifiers the native targets derive from the bundle id. */
export interface IosBundleIdentifiers {
  bundleId: string;
  /** App Group shared between the app and its widget extension, for non-secret shared state. */
  appGroupId: string;
  /** Keychain access group shared between the same two targets, for auth tokens. */
  keychainAccessGroup: string;
  /** The `apns-topic` a Live Activity push must carry to reach this app. */
  liveActivityApnsTopic: string;
}

/**
 * Spells the derived identifiers once instead of leaving them to be retyped into Xcode's
 * entitlements editor and into the push sender, where a mismatch fails silently: the entitlement
 * looks present and the push is simply never delivered.
 */
export function iosBundleIdentifiers(bundleId: string = IOS_BUNDLE_ID): IosBundleIdentifiers {
  return {
    bundleId,
    appGroupId: `group.${bundleId}`,
    keychainAccessGroup: `${bundleId}.shared`,
    liveActivityApnsTopic: `${bundleId}.push-type.liveactivity`,
  };
}

/** The variables these helpers read: `process.env`, or whatever a test hands them instead. */
export type EnvSource = Readonly<Record<string, string | undefined>>;

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Whether a host is reachable only from the local network, and so may be addressed over plaintext
 * http while developing. Public hosts may not: see `parseServerUrl`.
 */
function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (LOOPBACK_HOSTS.has(host) || host.endsWith(".local")) {
    return true;
  }

  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!ipv4) {
    return false;
  }

  const first = Number.parseInt(ipv4[1], 10);
  const second = Number.parseInt(ipv4[2], 10);
  if (first === 10 || first === 127) {
    return true;
  }
  if (first === 192 && second === 168) {
    return true;
  }
  if (first === 169 && second === 254) {
    return true;
  }
  return first === 172 && second >= 16 && second <= 31;
}

/**
 * Rejects anything that would produce a subtly wrong app rather than a failed sync. A path or query
 * on `server.url` is dropped by Capacitor, so accepting one would silently load the wrong page, and
 * plaintext http to a public host would ship an app whose every request can be read on the wire.
 */
function parseServerUrl(value: string, source: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${source} is not a valid absolute URL: ${value}`);
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`${source} must be an http or https URL, not ${url.protocol}//: ${value}`);
  }

  if (url.pathname !== "/" || url.search !== "" || url.hash !== "") {
    throw new Error(`${source} must be a bare origin, with no path, query or fragment: ${value}`);
  }

  if (url.protocol === "http:" && !isPrivateHost(url.hostname)) {
    throw new Error(
      `${source} is plaintext http against the public host ${url.hostname}. Cleartext is allowed ` +
        `only for a LAN or loopback address during local testing: ${value}`,
    );
  }

  return url;
}

function resolveServerOrigin(env: EnvSource): URL {
  const override = env[IOS_SERVER_URL_ENV]?.trim();
  if (override) {
    return parseServerUrl(override, IOS_SERVER_URL_ENV);
  }

  return parseServerUrl(IOS_PRODUCTION_SERVER_URL, "IOS_PRODUCTION_SERVER_URL");
}

/** The origin the synced project will load, after the override and its validation. */
export function resolveIosServerUrl(env: EnvSource = process.env): string {
  return resolveServerOrigin(env).origin;
}

/**
 * The whole of `capacitor.config.ts`, as a function of the environment, so that what the Mac will
 * sync can be asserted from a test on any platform.
 */
export function buildCapacitorConfig(env: EnvSource = process.env): CapacitorConfig {
  const origin = resolveServerOrigin(env);

  return {
    appId: IOS_BUNDLE_ID,
    appName: IOS_APP_NAME,
    webDir: IOS_WEB_DIR,
    server: {
      url: origin.origin,
      // Only the LAN override is ever plaintext; `parseServerUrl` has already refused a public
      // http host, so this cannot silently drop TLS for the production build.
      cleartext: origin.protocol === "http:",
      errorPath: IOS_ERROR_PAGE,
    },
  };
}
