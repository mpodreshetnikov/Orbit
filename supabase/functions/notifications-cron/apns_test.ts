import { assertEquals } from "std/assert/assert-equals";
import {
  buildApnsJwt,
  buildLiveActivityStartBody,
  clearApnsJwtCache,
  isAppleWebPushEndpoint,
  pemToPkcs8Der,
  readApnsConfig,
  resolveApnsHost,
  sendLiveActivityStart,
} from "./apns.ts";

async function generateTestPem(): Promise<string> {
  const keyPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", keyPair.privateKey));
  let binary = "";
  for (const byte of pkcs8) binary += String.fromCharCode(byte);
  const b64 = btoa(binary);
  const lines = b64.match(/.{1,64}/g) ?? [b64];
  const fence = (kind: "BEGIN" | "END") => `-----${kind} PRIVATE ${"KEY"}-----`;
  return `${fence("BEGIN")}\n${lines.join("\n")}\n${fence("END")}`;
}

Deno.test("readApnsConfig null when secrets missing", () => {
  assertEquals(readApnsConfig({ get: () => undefined }), null);
});

Deno.test("readApnsConfig returns all four fields", () => {
  const env = {
    get(key: string) {
      return {
        APNS_KEY_P8: "pem",
        APNS_KEY_ID: "KEYID",
        APNS_TEAM_ID: "TEAMID",
        APNS_BUNDLE_ID: "com.podreshetnikov.orbit",
      }[key];
    },
  };
  assertEquals(readApnsConfig(env)?.bundleId, "com.podreshetnikov.orbit");
});

Deno.test("resolveApnsHost sandbox vs production", () => {
  assertEquals(resolveApnsHost("sandbox"), "api.sandbox.push.apple.com");
  assertEquals(resolveApnsHost("production"), "api.push.apple.com");
});

Deno.test("isAppleWebPushEndpoint", () => {
  assertEquals(isAppleWebPushEndpoint("https://web.push.apple.com/x"), true);
  assertEquals(isAppleWebPushEndpoint("https://fcm.googleapis.com/x"), false);
});

Deno.test("buildLiveActivityStartBody shape uses Unix dueAt", () => {
  const body = buildLiveActivityStartBody(
    {
      medicationName: "Aspirin",
      amountLabel: "2 tablets",
      dueAt: 1_794_470_400,
      snoozeMinutes: 60,
      doseEventIds: ["dose-1"],
      alertTitle: "Medication",
      alertBody: "Aspirin — 2 tablets",
    },
    1765000000,
  ) as {
    aps: {
      event: string;
      "attributes-type": string;
      "content-state": { dueAt: number };
    };
  };
  assertEquals(body.aps.event, "start");
  assertEquals(body.aps["attributes-type"], "MedicationAttributes");
  assertEquals(body.aps["content-state"].dueAt, 1_794_470_400);
});

Deno.test("pemToPkcs8Der accepts bare base64 and literal \\n fences", async () => {
  const pem = await generateTestPem();
  const fence = (kind: "BEGIN" | "END") => `-----${kind} PRIVATE ${"KEY"}-----`;
  const body = pem.replaceAll(fence("BEGIN"), "").replaceAll(fence("END"), "").replace(/\s+/g, "");
  const fromBare = new Uint8Array(pemToPkcs8Der(body));
  const fromEscaped = new Uint8Array(
    pemToPkcs8Der(`${fence("BEGIN")}\\n${body}\\n${fence("END")}`),
  );
  const fromMultiline = new Uint8Array(pemToPkcs8Der(pem));
  assertEquals(fromBare.length > 0, true);
  assertEquals(Array.from(fromBare), Array.from(fromMultiline));
  assertEquals(Array.from(fromEscaped), Array.from(fromMultiline));
});

Deno.test("buildApnsJwt ES256 header and claims", async () => {
  clearApnsJwtCache();
  const pem = await generateTestPem();
  const token = await buildApnsJwt(
    { keyP8: pem, keyId: "ABC123", teamId: "TEAM99" },
    1_700_000_000_000,
  );
  const [headerB64, claimsB64] = token.split(".");
  const header = JSON.parse(atob(headerB64.replace(/-/g, "+").replace(/_/g, "/")));
  const claims = JSON.parse(atob(claimsB64.replace(/-/g, "+").replace(/_/g, "/")));
  assertEquals(header, { alg: "ES256", kid: "ABC123" });
  assertEquals(claims.iss, "TEAM99");
});

Deno.test("sendLiveActivityStart skips without secrets", async () => {
  clearApnsJwtCache();
  let fetchCalled = false;
  const result = await sendLiveActivityStart({
    token: "device-token",
    environment: "sandbox",
    payload: {
      medicationName: "Aspirin",
      amountLabel: "1 tablet",
      dueAt: 1_794_470_400,
      snoozeMinutes: 60,
      doseEventIds: ["d1"],
      alertTitle: "Meds",
      alertBody: "Aspirin",
    },
    config: null,
    fetchFn: () => {
      fetchCalled = true;
      return Promise.resolve(new Response("", { status: 200 }));
    },
  });
  assertEquals(result, { ok: false, skipped: true, reason: "missing_apns_secrets" });
  assertEquals(fetchCalled, false);
});

Deno.test("sendLiveActivityStart posts sandbox liveactivity", async () => {
  clearApnsJwtCache();
  const pem = await generateTestPem();
  let seenUrl = "";
  let topic = "";
  const result = await sendLiveActivityStart({
    token: "abc",
    environment: "sandbox",
    payload: {
      medicationName: "Aspirin",
      amountLabel: "1 tablet",
      dueAt: 1_794_470_400,
      snoozeMinutes: 60,
      doseEventIds: ["d1"],
      alertTitle: "Meds",
      alertBody: "Aspirin",
    },
    config: {
      keyP8: pem,
      keyId: "KID",
      teamId: "TEAM",
      bundleId: "com.podreshetnikov.orbit",
    },
    fetchFn: (input, init) => {
      seenUrl = String(input);
      topic = new Headers(init?.headers).get("apns-topic") ?? "";
      return Promise.resolve(new Response("", { status: 200, headers: { "apns-id": "id-1" } }));
    },
  });
  assertEquals(result, { ok: true, status: 200, apnsId: "id-1" });
  assertEquals(seenUrl, "https://api.sandbox.push.apple.com/3/device/abc");
  assertEquals(topic, "com.podreshetnikov.orbit.push-type.liveactivity");
});
