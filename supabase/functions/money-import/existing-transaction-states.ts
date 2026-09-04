import { isSessionUsable } from "./auth.ts";
import { jsonResponse, normalizeText } from "./normalize.ts";
import type { EdgeTelemetry } from "../_shared/observability.ts";
import type {
  ExistingTransactionStateCandidate,
  SessionAuthContext,
  UserAuthContext,
} from "./types.ts";
import type { MoneyImportRepository } from "./repository.ts";

interface ExistingTransactionStatesDeps {
  repository: MoneyImportRepository;
  telemetry?: EdgeTelemetry;
}

export async function getExistingTransactionStatesAction(
  body: Record<string, unknown>,
  auth: UserAuthContext | SessionAuthContext,
  deps: ExistingTransactionStatesDeps,
): Promise<Response> {
  const span = deps.telemetry?.startSpan("edge.money_import.get_existing_transaction_states");
  let source = normalizeText(body.source);
  let payerPersonId = normalizeText(body.payer_person_id);

  // A run nobody started has no user token; it asks on its session token, the way it does
  // everything else. Refusing that answered "nothing exists" to every such run, and in the full
  // strategy that meant re-reading, at eight seconds a receipt, every receipt the overlapping
  // window had already stored whole. Pinned to the session's own source and payer, as the
  // preview and apply actions pin theirs: a session token asks only about its own import.
  if (auth.mode === "session") {
    if (!isSessionUsable(auth.session)) {
      await span?.end({
        status: "error",
        statusMessage: "Import session expired or revoked",
      });
      return jsonResponse({ error: "Import session expired or revoked" }, 401);
    }
    source = normalizeText(auth.session.source);
    payerPersonId = normalizeText(auth.session.payer_person_id);
  }

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
    auth_mode: auth.mode,
    user_id: auth.mode === "user" ? auth.userId : null,
    session_id: auth.mode === "session" ? (normalizeText(auth.session.id) ?? null) : null,
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
