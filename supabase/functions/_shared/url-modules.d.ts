/**
 * Type declarations for bare-specifier imports resolved by deno.json at runtime.
 * Used so TypeScript/IDE can type-check without resolving URLs.
 */
declare module "std/encoding/base64" {
  export function encodeBase64(
    input: ArrayBuffer | Uint8Array | string,
  ): string;
}

declare module "web-push" {
  interface WebPush {
    setVapidDetails(
      subject: string,
      publicKey: string,
      privateKey: string,
    ): void;
    sendNotification(
      subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
      payload: string | Buffer,
      options?: Record<string, unknown>,
    ): Promise<unknown>;
  }
  const webpush: WebPush;
  export default webpush;
}
