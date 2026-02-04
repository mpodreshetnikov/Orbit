"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Search, Trash2 } from "lucide-react";
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
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useUpdateCheckupCompletion, useDeleteCheckupCompletion } from "@/hooks";
import type { CheckupCompletion } from "@/types";
import type { MedicalRecordListItem } from "@/types";

interface EditCompletionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  completion: CheckupCompletion | null;
  records: MedicalRecordListItem[];
  onSaved?: () => void;
}

function toDateOnly(s: string | null | undefined): string {
  if (!s || typeof s !== "string") return "";
  return s.slice(0, 10);
}

export function EditCompletionDialog({
  open,
  onOpenChange,
  completion,
  records,
  onSaved,
}: EditCompletionDialogProps) {
  const t = useTranslations();
  const [doneAt, setDoneAt] = useState("");
  const [note, setNote] = useState("");
  const [evidenceRecordId, setEvidenceRecordId] = useState<string>("none");
  const [recordSearch, setRecordSearch] = useState("");
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const updateMutation = useUpdateCheckupCompletion();
  const deleteMutation = useDeleteCheckupCompletion();

  useEffect(() => {
    if (open && completion) {
      setDoneAt(toDateOnly(completion.done_at));
      setNote(completion.note ?? "");
      setEvidenceRecordId(completion.evidence_record_id ?? "none");
      setRecordSearch("");
    }
  }, [open, completion]);

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
    if (!completion) return;
    const dateValue = doneAt?.trim().slice(0, 10) || toDateOnly(completion.done_at) || new Date().toISOString().slice(0, 10);
    await updateMutation.mutateAsync({
      id: completion.id,
      updates: {
        done_at: dateValue,
        note: note.trim() || null,
        evidence_record_id:
          evidenceRecordId && evidenceRecordId !== "none" ? evidenceRecordId : null,
      },
    });
    onSaved?.();
    onOpenChange(false);
  };

  const handleDelete = async () => {
    if (!completion) return;
    await deleteMutation.mutateAsync({
      id: completion.id,
      checkupItemId: completion.checkup_item_id,
    });
    setDeleteConfirmOpen(false);
    onSaved?.();
    onOpenChange(false);
  };

  if (!completion) return null;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("common.edit")}</DialogTitle>
            <DialogDescription>{t("checkups.completionHistory")}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit-completion-done-at">{t("checkups.completionDate")}</Label>
              <Input
                id="edit-completion-done-at"
                type="date"
                value={doneAt}
                onChange={(e) => setDoneAt(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-completion-note">{t("checkups.completionNote")}</Label>
              <Textarea
                id="edit-completion-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t("checkups.completionNotePlaceholder")}
                rows={2}
              />
            </div>

            <div className="space-y-2">
              <Label>{t("checkups.attachRecord")}</Label>
              <p className="text-xs text-muted-foreground">{t("checkups.attachRecordHint")}</p>
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder={t("records.search")}
                  value={recordSearch}
                  onChange={(e) => setRecordSearch(e.target.value)}
                  className="pl-8"
                />
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

          <DialogFooter className="flex-row justify-between sm:justify-between">
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => setDeleteConfirmOpen(true)}
              disabled={updateMutation.isPending || deleteMutation.isPending}
            >
              {deleteMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4 mr-1" />
              )}
              {t("common.delete")}
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {t("common.cancel")}
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={!doneAt || updateMutation.isPending}
              >
                {updateMutation.isPending && (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                )}
                {t("common.save")}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("common.delete")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("checkups.deleteCompletionConfirm")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              {t("common.delete")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
