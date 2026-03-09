import { jsonResponse, normalizeText } from "./normalize.ts";
import type { MoneyImportRepository } from "./repository.ts";
import type { AuthContext, BrandResolutionAction } from "./types.ts";

export interface UpdateBrandResolutionDeps {
  repository: MoneyImportRepository;
}

export async function updateBrandResolutionAction(
  body: Record<string, unknown>,
  auth: AuthContext,
  deps: UpdateBrandResolutionDeps,
): Promise<Response> {
  const resolutionId = normalizeText(body.resolution_id);
  if (!resolutionId) {
    return jsonResponse({ error: "resolution_id is required" }, 400);
  }

  if (auth.mode !== "user") {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const selectedAction = normalizeText(body.selected_action);
  if (selectedAction !== "match_existing" && selectedAction !== "create_new") {
    return jsonResponse({ error: "selected_action is required" }, 400);
  }

  const selectedBrandId = normalizeText(body.selected_brand_id);
  if (selectedAction === "match_existing" && !selectedBrandId) {
    return jsonResponse({ error: "selected_brand_id is required" }, 400);
  }

  const resolution = await deps.repository.getBatchBrandResolutionById?.(resolutionId);
  if (!resolution) {
    return jsonResponse({ error: "Brand resolution not found" }, 404);
  }

  const batchId = normalizeText(resolution.batch_id);
  if (!batchId) {
    return jsonResponse({ error: "Brand resolution batch is missing" }, 400);
  }

  const batch = await deps.repository.getImportBatch(batchId);
  if (!batch) {
    return jsonResponse({ error: "Batch not found" }, 404);
  }

  if (normalizeText(batch.status) !== "pending") {
    return jsonResponse({ error: "Batch is not awaiting review" }, 409);
  }

  await deps.repository.updateBatchBrandResolutionSelection?.(
    resolutionId,
    selectedAction as BrandResolutionAction,
    selectedAction === "match_existing" ? selectedBrandId : null,
  );

  return jsonResponse({
    resolution_id: resolutionId,
    selected_action: selectedAction,
    selected_brand_id: selectedAction === "match_existing" ? selectedBrandId : null,
  });
}
