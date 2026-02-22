"use client";

import React from "react";
import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCompleteCheckupItem, useUpdateCheckupItem } from "@/hooks";
import type { CheckupItem } from "@/types";
import type { MedicalRecordListItem } from "@/types";

interface MarkCompleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: CheckupItem | null;
  records: MedicalRecordListItem[];
  onSaved?: () => void;
}

export function MarkCompleteDialog({
  open,
  onOpenChange,
  item,
  records,
  onSaved,
}: MarkCompleteDialogProps) {
  const t = useTranslations();
  const [doneAt, setDoneAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [evidenceRecordId, setEvidenceRecordId] = useState<string>("none");
  const [recordSearch, setRecordSearch] = useState("");

  const completeMutation = useCompleteCheckupItem();
  const updateMutation = useUpdateCheckupItem();

  useEffect(() => {
    if (open) {
      setDoneAt(new Date().toISOString().slice(0, 10));
      setNote("");
      setEvidenceRecordId("none");
      setRecordSearch("");
    }
  }, [open]);

  const recordList = records ?? [];
  const filteredRecords = recordList.filter((r) => {
    if (!recordSearch.trim()) return true;
    const q = recordSearch.toLowerCase();
    return (
      r.title?.toLowerCase().includes(q) ||
      (r.record_date && r.record_date.toLowerCase().includes(q))
    );
  });
  const selectedRecord =
    evidenceRecordId && evidenceRecordId !== "none"
      ? recordList.find((r) => r.id === evidenceRecordId)
      : null;

  const handleSubmit = async () => {
    if (!item) return;
    const dateValue = doneAt?.trim().slice(0, 10) || new Date().toISOString().slice(0, 10);
    await completeMutation.mutateAsync({
      checkup_item_id: item.id,
      done_at: dateValue,
      note: note.trim() || null,
      evidence_record_id: evidenceRecordId && evidenceRecordId !== "none" ? evidenceRecordId : null,
    });
    if (item.planned_on) {
      await updateMutation.mutateAsync({ id: item.id, updates: { planned_on: null } });
    }
    onSaved?.();
    onOpenChange(false);
  };

  if (!item) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("checkups.markComplete")}</DialogTitle>
          <DialogDescription>{item.title}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="checkup-done-at">{t("checkups.completionDate")}</Label>
            <Input
              id="checkup-done-at"
              type="date"
              value={doneAt}
              onChange={(e) => setDoneAt(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="checkup-completion-note">{t("checkups.completionNote")}</Label>
            <Textarea
              id="checkup-completion-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t("checkups.completionNotePlaceholder")}
              rows={2}
            />
          </div>

          <div className="space-y-2">
            <Label>{t("checkups.attachRecord")}</Label>
            <p className="text-xs text-muted-foreground">{t("checkups.attachRecordHint")}</p>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder={t("records.search")}
                  value={recordSearch}
                  onChange={(e) => setRecordSearch(e.target.value)}
                  className="pl-8"
                />
              </div>
            </div>
            <ScrollArea className="h-[120px] rounded-md border p-2">
              <Button
                type="button"
                onClick={() => setEvidenceRecordId("none")}
                variant="ghost"
                className={`w-full justify-start px-2 py-1.5 text-sm h-auto ${evidenceRecordId === "none" ? "bg-muted font-medium" : "hover:bg-muted/50"}`}
              >
                {t("checkups.noRecord")}
              </Button>
              {filteredRecords.slice(0, 20).map((r) => (
                <Button
                  key={r.id}
                  type="button"
                  onClick={() => setEvidenceRecordId(r.id)}
                  variant="ghost"
                  className={`w-full justify-start px-2 py-1.5 text-sm h-auto truncate ${evidenceRecordId === r.id ? "bg-muted font-medium" : "hover:bg-muted/50"}`}
                >
                  {r.title}
                  {r.record_date ? ` (${r.record_date})` : ""}
                </Button>
              ))}
            </ScrollArea>
            {selectedRecord && (
              <p className="text-xs text-muted-foreground">
                {t("checkups.evidence")}: {selectedRecord.title}
                {selectedRecord.record_date ? ` — ${selectedRecord.record_date}` : ""}
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={handleSubmit} disabled={completeMutation.isPending}>
            {completeMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {t("checkups.markComplete")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
