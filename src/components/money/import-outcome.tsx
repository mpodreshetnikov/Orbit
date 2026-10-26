"use client";

import React, { useState } from "react";
import type { useTranslations } from "next-intl";
import { AlertTriangle, CheckCircle2, Loader2, RotateCcw, Undo2, XCircle } from "lucide-react";
import type { MoneyImportBatch } from "@/types";
import { importOutcome } from "@/types/money-import-review";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const TONE_CLASS = {
  running: "border-border",
  applied: "border-green-600/40",
  awaiting: "border-amber-500/50",
  rolled_back: "border-border",
  failed: "border-destructive/50",
  discarded: "border-border",
} as const;

/**
 * What an import's page leads with: a batch still being read, the result once it landed with the
 * way to undo it, or what became of it. Every batch the extension reads applies on its own
 * (T-261026-2ew), so this card replaces the old "apply or discard" banner as the page's headline.
 */
export function MoneyImportOutcome({
  t,
  batch,
  rollbackPending,
  onRollback,
}: {
  t: ReturnType<typeof useTranslations>;
  batch: MoneyImportBatch;
  rollbackPending: boolean;
  onRollback: () => void;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const outcome = importOutcome(batch.status);
  const rolledBackCount = Number(batch.meta?.rolled_back_transactions ?? batch.inserted_count) || 0;

  return (
    <Card className={TONE_CLASS[outcome]} data-testid="money-import-outcome" data-outcome={outcome}>
      <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex gap-3">
          <OutcomeIcon outcome={outcome} />
          <div className="space-y-1">
            {outcome === "running" && (
              <>
                <p className="font-semibold">{t("money.importOutcomeRunningTitle")}</p>
                <p className="text-sm text-muted-foreground">
                  {t("money.importOutcomeRunningHint", { count: batch.parsed_transactions_count })}
                </p>
              </>
            )}
            {outcome === "applied" && (
              <>
                <p className="font-semibold">
                  {t("money.importOutcomeAppliedTitle", {
                    inserted: batch.inserted_count,
                    skipped: batch.skipped_count,
                  })}
                </p>
                <p className="text-sm text-muted-foreground">
                  {t("money.importOutcomeAppliedHint")}
                </p>
                {batch.error_count > 0 && (
                  <p className="text-sm text-destructive">
                    {t("money.importOutcomeErrors", { count: batch.error_count })}
                  </p>
                )}
              </>
            )}
            {outcome === "awaiting" && (
              <>
                <p className="font-semibold">{t("money.importOutcomeAwaitingTitle")}</p>
                <p className="text-sm text-muted-foreground">
                  {t("money.importPendingReviewBanner")}
                </p>
              </>
            )}
            {outcome === "rolled_back" && (
              <>
                <p className="font-semibold">{t("money.importOutcomeRolledBackTitle")}</p>
                <p className="text-sm text-muted-foreground">
                  {t("money.importOutcomeRolledBackHint", { count: rolledBackCount })}
                </p>
              </>
            )}
            {outcome === "failed" && (
              <>
                <p className="font-semibold">{t("money.importOutcomeFailedTitle")}</p>
                <p className="text-sm text-muted-foreground">
                  {t("money.importOutcomeFailedHint")}
                </p>
              </>
            )}
            {outcome === "discarded" && (
              <p className="text-sm text-muted-foreground">{t("money.importDiscardedBanner")}</p>
            )}
          </div>
        </div>

        {outcome === "applied" && (
          <Button
            type="button"
            variant="outline"
            className="shrink-0 gap-2 text-destructive hover:text-destructive"
            disabled={rollbackPending}
            onClick={() => setConfirmOpen(true)}
          >
            <Undo2 className="h-4 w-4" />
            {rollbackPending ? t("common.loading") : t("money.importRollback")}
          </Button>
        )}
      </CardContent>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("money.importRollbackConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("money.importRollbackConfirmBody", { count: batch.inserted_count })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={onRollback}
            >
              {t("money.importRollback")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function OutcomeIcon({ outcome }: { outcome: ReturnType<typeof importOutcome> }) {
  const className = "mt-0.5 h-5 w-5 shrink-0";
  if (outcome === "running") {
    return <Loader2 className={`${className} animate-spin text-muted-foreground`} aria-hidden />;
  }
  if (outcome === "applied") {
    return <CheckCircle2 className={`${className} text-green-600`} aria-hidden />;
  }
  if (outcome === "failed")
    return <XCircle className={`${className} text-destructive`} aria-hidden />;
  if (outcome === "awaiting") {
    return <AlertTriangle className={`${className} text-amber-600`} aria-hidden />;
  }
  return <RotateCcw className={`${className} text-muted-foreground`} aria-hidden />;
}
