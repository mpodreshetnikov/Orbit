import type { EdgeTelemetry } from "../_shared/observability.ts";
import { jsonResponse, normalizeText } from "./normalize.ts";
import type { MoneyImportRepository } from "./repository.ts";
import type { AuthContext } from "./types.ts";

export interface DiscardBatchDeps {
  repository: MoneyImportRepository;
  now?: () => Date;
  telemetry?: EdgeTelemetry;
}

export async function discardBatchAction(
  body: Record<string, unknown>,
  auth: AuthContext,
  deps: DiscardBatchDeps,
): Promise<Response> {
  const actionSpan = deps.telemetry?.startSpan("edge.money_import.discard_batch");
  const batchId = normalizeText(body.batch_id);
  if (!batchId) {
    await actionSpan?.end({
      status: "error",
      statusMessage: "batch_id is required",
    });
    return jsonResponse({ error: "batch_id is required" }, 400);
  }

  if (auth.mode !== "user") {
    await actionSpan?.end({
      status: "error",
      statusMessage: "Unauthorized",
    });
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const batch = await deps.repository.getImportBatch(batchId);
  if (!batch) {
    await actionSpan?.end({
      status: "error",
      statusMessage: "Batch not found",
    });
    return jsonResponse({ error: "Batch not found" }, 404);
  }

  if (normalizeText(batch.status) !== "pending") {
    await actionSpan?.end({
      status: "error",
      statusMessage: "Batch is not awaiting review",
    });
    return jsonResponse({ error: "Batch is not awaiting review" }, 409);
  }

  await deps.repository.updateImportBatch(batchId, {
    status: "discarded",
    completed_at: (deps.now ?? (() => new Date()))().toISOString(),
  });
  deps.telemetry?.info("money_import_discard_batch_completed", {
    batch_id: batchId,
  });
  await actionSpan?.end({
    status: "ok",
    attrs: { batch_id: batchId },
  });

  return jsonResponse({
    batch_id: batchId,
    status: "discarded",
  });
}
