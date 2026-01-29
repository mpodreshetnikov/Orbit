"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { format } from "date-fns";
import Link from "next/link";
import {
  ArrowLeft,
  HeartPulse,
  Calendar,
  FileText,
  Clock,
  AlertCircle,
  CheckCircle2,
  HelpCircle,
  History,
  ExternalLink,
  Quote,
  Pencil,
  Loader2,
  Check,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useConditionDetail, useUpdateCondition, useIcdLookup, useMedicalRecords } from "@/hooks";
import { ConditionStatusBadge, ConditionAddHistoryDialog } from "@/components/conditions";
import { cn } from "@/lib/utils";
import type { ConditionStatus } from "@/types";

// Status icon component
function StatusIcon({ status, className }: { status: ConditionStatus; className?: string }) {
  const icons: Record<ConditionStatus, React.ReactNode> = {
    active: <AlertCircle className={cn("text-orange-500", className)} />,
    suspected: <HelpCircle className={cn("text-yellow-500", className)} />,
    resolved: <CheckCircle2 className={cn("text-green-500", className)} />,
    history: <History className={cn("text-gray-500", className)} />,
  };
  return icons[status] || null;
}

function ConditionDetailContent() {
  const params = useParams();
  const router = useRouter();
  const t = useTranslations();
  const conditionId = params.id as string;

  const { data: condition, isLoading, error, refetch } = useConditionDetail(conditionId);
  const updateConditionMutation = useUpdateCondition();
  const { data: personRecords } = useMedicalRecords(
    condition?.person_id ? { person_id: condition.person_id } : {}
  );
  
  // Edit dialog state (base info only; use Add to history for status)
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editCode, setEditCode] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [addHistoryOpen, setAddHistoryOpen] = useState(false);
  
  // ICD validation (validates entered code)
  const { data: icdLookup, isLoading: icdLoading } = useIcdLookup(
    editCode.length >= 2 ? editCode : null
  );
  
  const openEditDialog = () => {
    if (condition) {
      setEditName(condition.name);
      setEditCode(condition.code || "");
      setEditNotes(condition.notes || "");
      setIsEditing(true);
    }
  };
  
  const handleSaveEdit = async () => {
    if (!condition) return;
    
    await updateConditionMutation.mutateAsync({
      id: condition.id,
      updates: {
        name: editName.trim(),
        code: editCode.trim() || null,
        icd_name_en: icdLookup?.found ? icdLookup.name_en : null,
        notes: editNotes.trim() || null,
      },
    });
    
    setIsEditing(false);
  };
  
  // Generate Google search URL for ICD code lookup
  const getGoogleSearchUrl = (conditionName: string) => {
    const searchQuery = encodeURIComponent(`${conditionName} ICD-10 code`);
    return `https://www.google.com/search?q=${searchQuery}`;
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-10 w-10" />
          <div className="space-y-2">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-4 w-32" />
          </div>
        </div>
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error || !condition) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" onClick={() => router.back()}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          {t("common.back")}
        </Button>
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-8 text-center">
          <HeartPulse className="h-12 w-12 mx-auto mb-4 text-destructive opacity-50" />
          <p className="text-destructive font-medium">{t("conditions.conditionNotFound")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <Button variant="ghost" size="icon" className="shrink-0" onClick={() => router.back()}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <StatusIcon status={condition.current_status} className="h-5 w-5" />
              <ConditionStatusBadge status={condition.current_status} />
            </div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight">{condition.name}</h1>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setAddHistoryOpen(true)}>
            <History className="h-4 w-4 mr-2" />
            {t("conditions.addToHistory")}
          </Button>
          <Button variant="outline" size="sm" onClick={openEditDialog}>
            <Pencil className="h-4 w-4 mr-2" />
            {t("common.edit")}
          </Button>
        </div>
      </div>

      {/* ICD Info Card */}
      {(condition.code || condition.icd_name_en) && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Badge variant="outline" className="font-mono">
                {t("conditions.icdName")}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {condition.code && (
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="font-mono">
                  {condition.code}
                </Badge>
              </div>
            )}
            {condition.icd_name_en && (
              <div>
                <span className="text-sm text-muted-foreground">{t("conditions.icdOfficialName")}:</span>
                <p className="mt-1 font-medium">{condition.icd_name_en}</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Details Card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t("conditions.title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Status */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">{t("conditions.currentStatus")}</span>
            <ConditionStatusBadge status={condition.current_status} />
          </div>
          
          <Separator />

          {/* Timeline dates - only show if at least one date is set */}
          {(condition.onset_date || condition.resolved_date) && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                {condition.onset_date && (
                  <div>
                    <span className="text-sm text-muted-foreground block">{t("conditions.onsetDate")}</span>
                    <div className="flex items-center gap-2 mt-1">
                      <Calendar className="h-4 w-4 text-muted-foreground" />
                      <span>{format(new Date(condition.onset_date), "dd MMMM yyyy")}</span>
                    </div>
                  </div>
                )}
                {condition.resolved_date && (
                  <div>
                    <span className="text-sm text-muted-foreground block">{t("conditions.resolvedDate")}</span>
                    <div className="flex items-center gap-2 mt-1">
                      <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
                      <span>{format(new Date(condition.resolved_date), "dd MMMM yyyy")}</span>
                    </div>
                  </div>
                )}
              </div>
              <Separator />
            </>
          )}

          {/* Mention stats */}
          <div className="flex flex-wrap gap-4">
            <div>
              <span className="text-sm text-muted-foreground block">{t("conditions.mentions")}</span>
              <div className="flex items-center gap-2 mt-1">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <span className="font-semibold">{condition.mention_count}</span>
              </div>
            </div>
            {condition.first_mentioned_date && (
              <div>
                <span className="text-sm text-muted-foreground block">{t("conditions.firstMentioned")}</span>
                <span className="text-sm">
                  {format(new Date(condition.first_mentioned_date), "dd.MM.yyyy")}
                </span>
              </div>
            )}
            {condition.last_mentioned_date && condition.last_mentioned_date !== condition.first_mentioned_date && (
              <div>
                <span className="text-sm text-muted-foreground block">{t("conditions.lastMentioned")}</span>
                <span className="text-sm">
                  {format(new Date(condition.last_mentioned_date), "dd.MM.yyyy")}
                </span>
              </div>
            )}
          </div>

          {/* Notes */}
          {condition.notes && (
            <>
              <Separator />
              <div>
                <span className="text-sm text-muted-foreground block mb-1">{t("conditions.notes")}</span>
                <p className="text-sm whitespace-pre-wrap">{condition.notes}</p>
              </div>
            </>
          )}

          {/* Timestamps */}
          <Separator />
          <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
            <div className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              <span>
                {t("records.detail.createdAt")}: {format(new Date(condition.created_at), "dd.MM.yyyy HH:mm")}
              </span>
            </div>
            {condition.updated_at !== condition.created_at && (
              <div className="flex items-center gap-1">
                <Pencil className="h-3 w-3" />
                <span>
                  {t("records.detail.updatedAt")}: {format(new Date(condition.updated_at), "dd.MM.yyyy HH:mm")}
                </span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Timeline / History Card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <History className="h-4 w-4" />
            {t("conditions.mentionHistory")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {condition.history.length > 0 ? (
            <div className="relative">
              {/* Timeline line */}
              <div className="absolute left-4 top-0 bottom-0 w-px bg-border" />
              
              <div className="space-y-4">
                {condition.history.map((record) => (
                  <div key={record.id} className="relative pl-10">
                    {/* Timeline dot */}
                    <div className={cn(
                      "absolute left-2 top-2 w-4 h-4 rounded-full border-2 bg-background",
                      record.status_in_record === "active" && "border-orange-500",
                      record.status_in_record === "suspected" && "border-yellow-500",
                      record.status_in_record === "resolved" && "border-green-500",
                      record.status_in_record === "history" && "border-gray-500",
                    )} />
                    
                    <div className="rounded-lg border p-3 hover:bg-muted/50 transition-colors">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          {/* Record title */}
                          <div className="flex items-center gap-2 flex-wrap">
                            <Link 
                              href={`/health/records/${record.record_id}`}
                              className="font-medium hover:underline truncate"
                            >
                              {record.record_title || t("records.title")}
                            </Link>
                            {record.record_type && (
                              <Badge variant="outline" className="text-xs">
                                {t(`records.types.${record.record_type}`)}
                              </Badge>
                            )}
                          </div>
                          
                          {/* Date and status */}
                          <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
                            {record.record_date && (
                              <div className="flex items-center gap-1">
                                <Calendar className="h-3 w-3" />
                                {format(new Date(record.record_date), "dd.MM.yyyy")}
                              </div>
                            )}
                            <ConditionStatusBadge status={record.status_in_record as ConditionStatus} />
                          </div>

                          {/* Source anchor */}
                          {record.source_anchor && (
                            <div className="mt-2 flex items-start gap-2 text-xs text-muted-foreground bg-muted/50 rounded p-2">
                              <Quote className="h-3 w-3 shrink-0 mt-0.5" />
                              <span className="italic line-clamp-2">{record.source_anchor}</span>
                            </div>
                          )}
                        </div>

                        {/* Link to record */}
                        <Link 
                          href={`/health/records/${record.record_id}`}
                          className="shrink-0"
                        >
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <ExternalLink className="h-4 w-4" />
                          </Button>
                        </Link>
                      </div>

                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <History className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">{t("conditions.noHistory")}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={isEditing} onOpenChange={setIsEditing}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("conditions.edit")}</DialogTitle>
            <DialogDescription>{t("conditions.editDescription")}</DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            {/* Name */}
            <div className="space-y-2">
              <Label htmlFor="editName">{t("conditions.name")}</Label>
              <Input
                id="editName"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
              />
            </div>
            
            {/* ICD Code */}
            <div className="space-y-2">
              <Label htmlFor="editCode">{t("conditions.icdCode")}</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="editCode"
                  value={editCode}
                  onChange={(e) => setEditCode(e.target.value.toUpperCase())}
                  placeholder="H52.1"
                  className="font-mono w-28"
                />
                {icdLoading && (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                )}
                {icdLookup?.found && (
                  <div className="flex items-center gap-1 text-green-600 flex-1 min-w-0">
                    <Check className="h-4 w-4 shrink-0" />
                    <span className="text-sm truncate">{icdLookup.name_en}</span>
                  </div>
                )}
                {editCode && !icdLoading && icdLookup && !icdLookup.found && (
                  <div className="flex items-center gap-1 text-yellow-600">
                    <AlertTriangle className="h-4 w-4" />
                    <span className="text-sm">{t("conditions.icdNotFound")}</span>
                  </div>
                )}
              </div>
              
              {/* Google search link to find ICD code */}
              {editName.trim() && (
                <a
                  href={getGoogleSearchUrl(editName.trim())}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ExternalLink className="h-3 w-3" />
                  {t("conditions.findIcdCode")}
                </a>
              )}
            </div>
            
            {/* Notes */}
            <div className="space-y-2">
              <Label htmlFor="editNotes">{t("conditions.notes")}</Label>
              <Textarea
                id="editNotes"
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditing(false)}>
              {t("common.cancel")}
            </Button>
            <Button 
              onClick={handleSaveEdit} 
              disabled={!editName.trim() || updateConditionMutation.isPending}
            >
              {updateConditionMutation.isPending && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add to history dialog */}
      {condition && (
        <ConditionAddHistoryDialog
          open={addHistoryOpen}
          onOpenChange={setAddHistoryOpen}
          conditionId={condition.id}
          personId={condition.person_id}
          records={personRecords || []}
          onSaved={() => refetch()}
        />
      )}
    </div>
  );
}

export default function ConditionDetailPage() {
  return <ConditionDetailContent />;
}
