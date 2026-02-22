type EnvValue = string | undefined;

type EnvOverrides = Record<string, EnvValue>;

/**
 * Apply environment overrides for a test and restore previous values afterwards.
 */
export async function withEnv<T>(overrides: EnvOverrides, run: () => Promise<T> | T): Promise<T> {
  const previous = new Map<string, EnvValue>();
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, Deno.env.get(key));
    if (value === undefined) {
      Deno.env.delete(key);
    } else {
      Deno.env.set(key, value);
    }
  }

  try {
    return await run();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        Deno.env.delete(key);
      } else {
        Deno.env.set(key, value);
      }
    }
  }
}
