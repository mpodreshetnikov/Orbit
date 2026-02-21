import type { Connector } from "../connectors/types.js";

export interface ImportRunnerDeps {
  getConnector: (sourceId: string) => Connector | null;
  callEdge: (
    functionUrl: string,
    token: string,
    payload: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
  broadcastToAppTabs: (message: Record<string, unknown>) => Promise<void>;
  nowIso: () => string;
}

export async function runImportSession(
  session: Record<string, unknown>,
  windowFromInput: string | undefined,
  deps: ImportRunnerDeps,
): Promise<Record<string, unknown>> {
  const connector = deps.getConnector((session.source as string) ?? "");
  if (!connector) {
    throw new Error(`No connector for source: ${session.source}`);
  }

  const windowFrom = windowFromInput || (session.last_imported_at as string) || deps.nowIso();
  const parseOutput = await connector.parse({
    source: session.source as string,
    windowFrom,
    session,
  });

  await deps.broadcastToAppTabs({
    type: "MONEY_IMPORT_PROGRESS",
    parsed_transactions_count: parseOutput.parsedTransactionsCount,
    parsed_through_at: parseOutput.parsedThroughAt,
  });

  const applyResult = await deps.callEdge(
    session.function_url as string,
    session.session_token as string,
    {
      action: "apply_rows",
      session_id: session.session_id,
      batch_id: session.batch_id,
      window_from: windowFrom,
      window_to: parseOutput.windowTo,
      parsed_through_at: parseOutput.parsedThroughAt,
      parsed_transactions_count: parseOutput.parsedTransactionsCount,
      rows: parseOutput.rows,
    },
  );

  await deps.callEdge(session.function_url as string, session.session_token as string, {
    action: "complete_session",
    session_id: session.session_id,
    batch_id: session.batch_id,
    status: "completed",
  });

  await deps.broadcastToAppTabs({
    type: "MONEY_IMPORT_DONE",
    batch_id: (applyResult as { batch_id?: string }).batch_id ?? session.batch_id,
  });

  return applyResult;
}

export async function tryCompleteSessionAsFailed(
  session: Record<string, unknown>,
  callEdge: ImportRunnerDeps["callEdge"],
): Promise<void> {
  try {
    await callEdge(session.function_url as string, session.session_token as string, {
      action: "complete_session",
      session_id: session.session_id,
      batch_id: session.batch_id,
      status: "failed",
    });
  } catch {
    // Ignore completion failures; original error is still reported to UI.
  }
}
