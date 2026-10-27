import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import {
  InstanceConfigError,
  normalizeAddress,
  resolveInstanceConfig,
  type InstanceConfig,
} from "@/lib/instance-config";

/** An instance the app talks to: the address the person knows it by, and what it serves there. */
export type Instance = InstanceConfig & { address: string };

const STORAGE_KEY = "orbit.instance";

/** How long a server gets to answer before the app says it could not reach it. */
const DISCOVERY_TIMEOUT_MS = 10_000;

/** `undefined` until the phone's choice is read; the build's own instance stands in until then. */
let current: Instance | null | undefined;

/** The instance in use, or `null` when none is chosen and the build names none. */
export function currentInstance(): Instance | null {
  current ??= buildInstance();
  return current;
}

/**
 * The instance a build was pointed at with `EXPO_PUBLIC_SUPABASE_URL`, for development, previews and
 * recordings; `null` for a release build, which asks its user instead.
 */
export function buildInstance(): Instance | null {
  try {
    const config = resolveInstanceConfig(Constants.expoConfig?.extra);
    return { ...config, address: config.supabaseUrl };
  } catch {
    return null;
  }
}

/**
 * The instance to start with: the one chosen on this phone, else the build's own, else none — and
 * then the app asks.
 */
export async function loadInstance(): Promise<Instance | null> {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<Instance>;
      const config = resolveInstanceConfig(parsed);
      current = { ...config, address: normalizeAddress(String(parsed.address)) };
      return current;
    }
  } catch {
    // A choice that can no longer be read is no choice: fall through to the build's, or ask again.
  }
  current = buildInstance();
  return current;
}

/** Use this instance from now on, on this phone. */
export async function saveInstance(instance: Instance): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(instance));
  current = instance;
}

/**
 * Ask the server at a typed address what it serves: `/.well-known/orbit-instance` on that origin,
 * which every Orbit web app answers with its data API's address and anon key (both public). Only
 * data is read from it, never code, and what it names is held to the same https rules.
 */
export async function discoverInstance(
  input: string,
  fetchImpl: (url: string, init: RequestInit) => Promise<Response> = fetch,
): Promise<Instance> {
  const address = normalizeAddress(input);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetchImpl(`${address}/.well-known/orbit-instance`, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
  } catch {
    throw new InstanceConfigError(`Could not reach ${address}.`, "unreachable");
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    throw new InstanceConfigError(
      `${address} is not an Orbit server (HTTP ${response.status}).`,
      "notOrbit",
    );
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new InstanceConfigError(`${address} is not an Orbit server.`, "notOrbit");
  }
  try {
    return { ...resolveInstanceConfig(body), address };
  } catch {
    throw new InstanceConfigError(
      `${address} answered with a configuration the app cannot use.`,
      "badConfig",
    );
  }
}
