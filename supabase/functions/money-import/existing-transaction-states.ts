import { jsonResponse, normalizeText } from "./normalize.ts";
import type { EdgeTelemetry } from "../_shared/observability.ts";
import type { ExistingTransactionStateCandidate, UserAuthContext } from "./types.ts";
import type { MoneyImportRepository } from "./repository.ts";

interface ExistingTransactionStatesDeps {
  repository: MoneyImportRepository;
  telemetry?: EdgeTelemetry;
}

export async function getExistingTransactionStatesAction(
  body: Record<string, unknown>,
  auth: UserAuthContext,
  deps: ExistingTransactionStatesDeps,
): Promise<Response> {
  const span = deps.telemetry?.startSpan("edge.money_import.get_existing_transaction_states");
  const source = normalizeText(body.source);
  const payerPersonId = normalizeText(body.payer_person_id);
  const candidates = Array.isArray(body.candidates)
    ? (body.candidates as ExistingTransactionStateCandidate[])
    : null;

  if (!source || !payerPersonId) {
    await span?.end({
      status: "error",
      statusMessage: "source and payer_person_id are required",
    });
    return jsonResponse({ error: "source and payer_person_id are required" }, 400);
  }
  if (!candidates) {
    await span?.end({
      status: "error",
      statusMessage: "candidates must be an array",
    });
    return jsonResponse({ error: "candidates must be an array" }, 400);
  }

  const states = await deps.repository.getExistingTransactionStates(
    source,
    payerPersonId,
    candidates,
  );
  deps.telemetry?.info("money_import_get_existing_transaction_states_completed", {
    source,
    user_id: auth.userId,
    candidate_count: candidates.length,
    fulfilled_count: states.filter((state) => state.fulfilled).length,
  });
  await span?.end({
    status: "ok",
    attrs: {
      source,
      candidate_count: candidates.length,
      fulfilled_count: states.filter((state) => state.fulfilled).length,
    },
  });
  return jsonResponse({ states });
}
