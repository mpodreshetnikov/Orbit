import extensionManifest from "../../browserExtension/manifest.json";

export interface ChromeRuntimeMock {
  sendMessage: (...args: unknown[]) => void;
  getURL: (path: string) => string;
  /**
   * The background reads its own version from here rather than importing `manifest.json`, so
   * the mock has to offer it — see `resolveExtensionVersion` in `background-router.ts` for why
   * that import had to go.
   */
  getManifest: () => { version: string };
  reload: () => void;
  onMessage: {
    addListener: (...args: unknown[]) => void;
    removeListener: (...args: unknown[]) => void;
  };
}

export interface ChromeStorageMock {
  local: {
    get: (...args: unknown[]) => Promise<Record<string, unknown>>;
    set: (...args: unknown[]) => Promise<void>;
  };
}

export interface ChromeTabsMock {
  query: (...args: unknown[]) => Promise<Array<{ id?: number }>>;
  sendMessage: (...args: unknown[]) => Promise<unknown>;
  update: (...args: unknown[]) => Promise<unknown>;
}

export interface ChromeMock {
  runtime: ChromeRuntimeMock;
  storage: ChromeStorageMock;
  tabs: ChromeTabsMock;
}

export function createChromeMock(): ChromeMock {
  return {
    runtime: {
      sendMessage: () => {},
      getURL: (path: string) => `chrome-extension://unit-test/${path}`,
      getManifest: () => ({ version: extensionManifest.version }),
      reload: () => {},
      onMessage: {
        addListener: () => {},
        removeListener: () => {},
      },
    },
    storage: {
      local: {
        get: async () => ({}),
        set: async () => {},
      },
    },
    tabs: {
      query: async () => [],
      sendMessage: async () => null,
      update: async () => null,
    },
  };
}

export function installChromeMock(overrides: Partial<ChromeMock> = {}): ChromeMock {
  const base = createChromeMock();

  const nextMock: ChromeMock = {
    ...base,
    ...overrides,
    runtime: {
      ...base.runtime,
      ...overrides.runtime,
      onMessage: {
        ...base.runtime.onMessage,
        ...overrides.runtime?.onMessage,
      },
    },
    storage: {
      ...base.storage,
      ...overrides.storage,
      local: {
        ...base.storage.local,
        ...overrides.storage?.local,
      },
    },
    tabs: {
      ...base.tabs,
      ...overrides.tabs,
    },
  };

  Object.defineProperty(globalThis, "chrome", {
    value: nextMock,
    writable: true,
    configurable: true,
  });

  return nextMock;
}

export function clearChromeMock(): void {
  Reflect.deleteProperty(globalThis, "chrome");
}
