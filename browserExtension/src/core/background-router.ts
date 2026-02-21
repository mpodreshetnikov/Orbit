import {
  runImportSession,
  tryCompleteSessionAsFailed,
  type ImportRunnerDeps,
} from "./import-runner.js";
import type { SessionStore } from "./session-store.js";

export interface BackgroundMessage {
  type: string;
  session?: Record<string, unknown>;
  windowFrom?: string;
}

export interface BackgroundRouterDeps {
  sessionStore: SessionStore;
  importRunnerDeps: ImportRunnerDeps;
}

export async function routeBackgroundMessage(
  message: BackgroundMessage,
  deps: BackgroundRouterDeps,
): Promise<Record<string, unknown>> {
  if (message.type === "MONEY_IMPORT_PING") {
    return { ok: true };
  }

  if (message.type === "MONEY_IMPORT_START_SESSION") {
    await deps.sessionStore.setSession(message.session ?? null);
    return { ok: true };
  }

  if (message.type === "MONEY_IMPORT_GET_SESSION") {
    const session = await deps.sessionStore.getSession();
    return { ok: true, session };
  }

  if (message.type === "MONEY_IMPORT_RUN") {
    const session = await deps.sessionStore.getSession();
    if (!session) {
      throw new Error("No active import session");
    }

    try {
      const result = await runImportSession(session, message.windowFrom, deps.importRunnerDeps);
      return { ok: true, result };
    } catch (error) {
      await tryCompleteSessionAsFailed(session, deps.importRunnerDeps.callEdge);
      throw error;
    }
  }

  return { ok: false, error: "Unsupported message type" };
}
