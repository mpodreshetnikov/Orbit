"use client";

import { useState, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { AlertCircle, HelpCircle, CheckCircle2, History, Loader2, Search, ChevronsUpDown, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useLinkConditionToRecord, useCreateMedicalRecord } from "@/hooks";
import type { ConditionStatus } from "@/types";
import type { MedicalRecordListItem } from "@/types";

interface ConditionAddHistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conditionId: string;
  personId: string;
  records: MedicalRecordListItem[];
  /** When opening from a record context (e.g. record detail), pre-select this record */
  preselectedRecordId?: string | null;
  onSaved?: () => void;
}

export function ConditionAddHistoryDialog({
  open,
  onOpenChange,
  conditionId,
  personId,
  records,
  preselectedRecordId,
  onSaved,
}: ConditionAddHistoryDialogProps) {
  const t = useTranslations();
  const [status, setStatus] = useState<ConditionStatus>("active");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [recordId, setRecordId] = useState<string>("none");
  const [recordSearch, setRecordSearch] = useState("");
  const [isRecordOpen, setIsRecordOpen] = useState(false);
  const recordRef = useRef<HTMLDivElement>(null);
  const recordInputRef = useRef<HTMLInputElement>(null);

  const linkMutation = useLinkConditionToRecord();
  const createRecordMutation = useCreateMedicalRecord();
  const isPending = linkMutation.isPending || createRecordMutation.isPending;

  useEffect(() => {
    if (open) {
      setDate(new Date().toISOString().slice(0, 10));
      setNote("");
      setRecordId(preselectedRecordId || "none");
      setRecordSearch("");
      setIsRecordOpen(false);
    }
  }, [open, preselectedRecordId]);

  // Close record dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (recordRef.current && !recordRef.current.contains(event.target as Node)) {
        setIsRecordOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const selectedRecord = recordId && recordId !== "none" ? records.find((r) => r.id === recordId) : null;
  const recordDisplayValue = selectedRecord
    ? `${selectedRecord.title}${selectedRecord.record_date ? ` (${selectedRecord.record_date})` : ""}`
    : t("conditions.noLinkToRecord");

  const filteredRecords = records.filter((r) => {
    if (!recordSearch.trim()) return true;
    const q = recordSearch.toLowerCase();
    return (
      r.title?.toLowerCase().includes(q) ||
      (r.record_date && r.record_date.toLowerCase().includes(q))
    );
  });

  const handleSave = async () => {
    let targetRecordId: string;

    if (recordId && recordId !== "none") {
      targetRecordId = recordId;
    } else {
      // Create a "Manual entry" medical record for this date; duplicate note into record so it shows in records list
      const newRecord = await createRecordMutation.mutateAsync({
        person_id: personId,
        title: t("conditions.manualEntryTitle"),
        record_date: date || null,
        record_type: "other",
        status: "active",
        notes: note.trim() || undefined,
      });
      targetRecordId = newRecord.id;
    }

    await linkMutation.mutateAsync({
      condition_id: conditionId,
      record_id: targetRecordId,
      status_in_record: status,
      source_anchor: note.trim() || undefined,
    });

    onSaved?.();
    onOpenChange(false);
  };

  const canSave = !!date;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("conditions.addToHistory")}</DialogTitle>
          <DialogDescription>
            {t("conditions.addToHistoryDescription")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Status */}
          <div className="space-y-2">
            <Label>{t("conditions.statusInRecord")}</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as ConditionStatus)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="h-3.5 w-3.5 text-orange-500" />
                    {t("conditions.status.active")}
                  </div>
                </SelectItem>
                <SelectItem value="suspected">
                  <div className="flex items-center gap-2">
                    <HelpCircle className="h-3.5 w-3.5 text-yellow-500" />
                    {t("conditions.status.suspected")}
                  </div>
                </SelectItem>
                <SelectItem value="resolved">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                    {t("conditions.status.resolved")}
                  </div>
                </SelectItem>
                <SelectItem value="history">
                  <div className="flex items-center gap-2">
                    <History className="h-3.5 w-3.5 text-gray-500" />
                    {t("conditions.status.history")}
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Date */}
          <div className="space-y-2">
            <Label htmlFor="history-date">{t("conditions.historyDate")}</Label>
            <Input
              id="history-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>

          {/* Note */}
          <div className="space-y-2">
            <Label htmlFor="history-note">{t("conditions.historyNote")}</Label>
            <Textarea
              id="history-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t("conditions.historyNotePlaceholder")}
              rows={2}
            />
          </div>

          {/* Link to medical record (optional) — searchable */}
          <div className="space-y-2">
            <Label>{t("conditions.linkToRecord")}</Label>
            <div className="relative" ref={recordRef}>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                <Input
                  ref={recordInputRef}
                  value={isRecordOpen ? recordSearch : recordDisplayValue}
                  onChange={(e) => {
                    setRecordSearch(e.target.value);
                    if (!isRecordOpen) setIsRecordOpen(true);
                  }}
                  onFocus={() => {
                    setIsRecordOpen(true);
                    setRecordSearch("");
                  }}
                  placeholder={t("conditions.searchRecordPlaceholder")}
                  className="pl-9 pr-9"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0 h-full w-9 hover:bg-transparent"
                  onClick={() => {
                    setIsRecordOpen(!isRecordOpen);
                    if (!isRecordOpen) {
                      setRecordSearch("");
                      recordInputRef.current?.focus();
                    }
                  }}
                >
                  <ChevronsUpDown className="h-4 w-4 text-muted-foreground" />
                </Button>
              </div>

              {isRecordOpen && (
                <div className="absolute z-50 w-full mt-1 bg-popover border rounded-md shadow-md">
                  <ScrollArea className="h-48">
                    <div className="p-1">
                      <button
                        type="button"
                        onClick={() => {
                          setRecordId("none");
                          setRecordSearch("");
                          setIsRecordOpen(false);
                        }}
                        className={`w-full flex items-center gap-2 px-2 py-2 text-sm rounded hover:bg-accent text-left ${
                          recordId === "none" ? "bg-accent" : ""
                        }`}
                      >
                        <Check className={`h-4 w-4 shrink-0 ${recordId === "none" ? "opacity-100" : "opacity-0"}`} />
                        {t("conditions.noLinkToRecord")}
                      </button>
                      {filteredRecords.map((r) => (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => {
                            setRecordId(r.id);
                            setRecordSearch("");
                            setIsRecordOpen(false);
                          }}
                          className={`w-full flex items-center gap-2 px-2 py-2 text-sm rounded hover:bg-accent text-left ${
                            recordId === r.id ? "bg-accent" : ""
                          }`}
                        >
                          <Check className={`h-4 w-4 shrink-0 ${recordId === r.id ? "opacity-100" : "opacity-0"}`} />
                          <div className="flex-1 min-w-0 text-left">
                            <div className="truncate">{r.title}</div>
                            {r.record_date && (
                              <div className="text-xs text-muted-foreground">{r.record_date}</div>
                            )}
                          </div>
                        </button>
                      ))}
                      {filteredRecords.length === 0 && recordSearch && (
                        <div className="px-2 py-4 text-sm text-center text-muted-foreground">
                          {t("conditions.noRecordSearchResults")}
                        </div>
                      )}
                    </div>
                  </ScrollArea>
                </div>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {t("conditions.linkToRecordHint")}
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={handleSave} disabled={!canSave || isPending}>
            {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
