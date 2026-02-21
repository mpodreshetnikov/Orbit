/**
 * Minimal Deno globals for Edge Function type-checking.
 * Full types: https://deno.land/cli/typedoc
 */
declare const Deno: {
  env: { get(key: string): string | undefined };
  serve: (handler: (req: Request) => Promise<Response> | Response) => void;
};
