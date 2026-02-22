"use client";

import React from "react";
import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import {
  AlertCircle,
  HelpCircle,
  CheckCircle2,
  History,
  Loader2,
  ChevronsUpDown,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
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
  conditionName: string;
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
  conditionName,
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

  const selectedRecord =
    recordId && recordId !== "none" ? records.find((r) => r.id === recordId) : null;
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
      // Create a "Manual entry" medical record for this date; title = "Manual entry (Condition name)"; duplicate note into record
      const manualTitle = `${t("conditions.manualEntryTitle")} (${conditionName})`;
      const newRecord = await createRecordMutation.mutateAsync({
        person_id: personId,
        title: manualTitle,
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
          <DialogDescription>{t("conditions.addToHistoryDescription")}</DialogDescription>
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
            <div className="relative">
              <Popover
                open={isRecordOpen}
                onOpenChange={(open) => {
                  setIsRecordOpen(open);
                  if (open) setRecordSearch("");
                }}
              >
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    role="combobox"
                    aria-expanded={isRecordOpen}
                    className={`h-10 w-full justify-between px-3 py-2 text-sm ${!recordDisplayValue ? "text-muted-foreground" : ""}`}
                  >
                    <span className="truncate">
                      {recordDisplayValue || t("conditions.searchRecordPlaceholder")}
                    </span>
                    <ChevronsUpDown className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                  <Command shouldFilter={false}>
                    <CommandInput
                      value={recordSearch}
                      onValueChange={setRecordSearch}
                      placeholder={t("conditions.searchRecordPlaceholder")}
                      autoFocus
                    />
                    <CommandList className="max-h-48">
                      <CommandGroup>
                        <CommandItem
                          value="none"
                          onSelect={() => {
                            setRecordId("none");
                            setRecordSearch("");
                            setIsRecordOpen(false);
                          }}
                          className={recordId === "none" ? "bg-accent" : ""}
                        >
                          <Check
                            className={`h-4 w-4 shrink-0 ${recordId === "none" ? "opacity-100" : "opacity-0"}`}
                          />
                          {t("conditions.noLinkToRecord")}
                        </CommandItem>
                        {filteredRecords.map((r) => (
                          <CommandItem
                            key={r.id}
                            value={r.id}
                            onSelect={() => {
                              setRecordId(r.id);
                              setRecordSearch("");
                              setIsRecordOpen(false);
                            }}
                            className={recordId === r.id ? "bg-accent" : ""}
                          >
                            <Check
                              className={`h-4 w-4 shrink-0 ${recordId === r.id ? "opacity-100" : "opacity-0"}`}
                            />
                            <div className="flex-1 min-w-0 text-left">
                              <div className="truncate">{r.title}</div>
                              {r.record_date && (
                                <div className="text-xs text-muted-foreground">{r.record_date}</div>
                              )}
                            </div>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                      {filteredRecords.length === 0 && recordSearch && (
                        <CommandEmpty>{t("conditions.noRecordSearchResults")}</CommandEmpty>
                      )}
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
            <p className="text-xs text-muted-foreground">{t("conditions.linkToRecordHint")}</p>
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
