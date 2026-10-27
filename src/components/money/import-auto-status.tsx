"use client";

import React from "react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  IMPORT_SCHEDULE_MAX_DAYS,
  readImportAutoSchedule,
  type ImportAutoSchedule,
} from "@/lib/money/extension-bridge";

/**
 * What the extension will do on its own, as it reports it.
 *
 * The first live runs of unattended import ended with "I opened the bank and nothing
 * happened", and from the app there was no way to tell a missing key from a backoff after a
 * failed run from a sweep still waiting out its minute. This is the extension's own account:
 * the key it holds, and per source the last attempt, what it said, and when the next may
 * start. The token itself never comes back.
 */
export interface ExtensionAutoStatusSource {
  source_id: string;
  last_run_at: string | null;
  last_result: "ok" | "error" | null;
  consecutive_failures: number;
  last_error: string | null;
  /** `requested`: the sweep ran because the person asked from the attention page. */
  last_run_origin: "auto" | "manual" | "requested" | null;
  next_run: { kind: "now" } | { kind: "after"; at: string } | { kind: "stopped" };
  scheduled_at: string | null;
}

export interface ExtensionAutoStatus {
  grant: { person_id: string; allowed_sources: string[]; received_at: string } | null;
  sources: ExtensionAutoStatusSource[];
  /** How often it imports on its own. Null or absent from an extension older than the setting. */
  schedule?: ImportAutoSchedule | null;
}

type Translate = (key: string, values?: Record<string, string | number>) => string;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function readResult(value: unknown): ExtensionAutoStatusSource["last_result"] {
  return value === "ok" || value === "error" ? value : null;
}

function readOrigin(value: unknown): ExtensionAutoStatusSource["last_run_origin"] {
  return value === "auto" || value === "manual" || value === "requested" ? value : null;
}

function readNextRun(value: unknown): ExtensionAutoStatusSource["next_run"] {
  const record = asRecord(value);
  if (record?.kind === "after" && typeof record.at === "string") {
    return { kind: "after", at: record.at };
  }
  if (record?.kind === "stopped") return { kind: "stopped" };
  return { kind: "now" };
}

/** The bridge's reply, checked field by field: it crosses a postMessage boundary. */
export function readExtensionAutoStatus(data: Record<string, unknown>): ExtensionAutoStatus | null {
  if (data.ok !== true) return null;
  const grantRecord = asRecord(data.grant);
  const grant =
    grantRecord &&
    typeof grantRecord.person_id === "string" &&
    typeof grantRecord.received_at === "string" &&
    Array.isArray(grantRecord.allowed_sources)
      ? {
          person_id: grantRecord.person_id,
          allowed_sources: grantRecord.allowed_sources.filter(
            (source): source is string => typeof source === "string",
          ),
          received_at: grantRecord.received_at,
        }
      : null;
  const sources = (Array.isArray(data.sources) ? data.sources : [])
    .map(asRecord)
    .filter((record): record is Record<string, unknown> => Boolean(record))
    .filter((record) => typeof record.source_id === "string")
    .map((record) => ({
      source_id: record.source_id as string,
      last_run_at: asString(record.last_run_at),
      last_result: readResult(record.last_result),
      consecutive_failures:
        typeof record.consecutive_failures === "number" ? record.consecutive_failures : 0,
      last_error: asString(record.last_error),
      last_run_origin: readOrigin(record.last_run_origin),
      next_run: readNextRun(record.next_run),
      scheduled_at: asString(record.scheduled_at),
    }));
  return { grant, sources, schedule: readImportAutoSchedule(data.schedule) };
}

function formatMoment(iso: string): string {
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) ? format(date, "dd.MM.yyyy HH:mm") : iso;
}

function describeSource(
  source: ExtensionAutoStatusSource,
  label: string,
  t: Translate,
): { lines: string[]; tone: "ok" | "error" | "idle" } {
  const lines: string[] = [];
  const next =
    source.next_run.kind === "after"
      ? t("money.importAutoStatusNextAfter", { next: formatMoment(source.next_run.at) })
      : source.next_run.kind === "now"
        ? t("money.importAutoStatusEligibleNow")
        : null;
  const scheduled = source.scheduled_at
    ? t("money.importAutoStatusScheduled", { time: formatMoment(source.scheduled_at) })
    : null;

  if (source.next_run.kind === "stopped") {
    if (source.last_run_at && source.last_error) {
      lines.push(
        t("money.importAutoStatusLastFailed", {
          date: formatMoment(source.last_run_at),
          error: source.last_error,
        }),
      );
    }
    lines.push(t("money.importAutoStatusStopped", { count: source.consecutive_failures }));
    return { lines, tone: "error" };
  }

  if (!source.last_run_at) {
    lines.push(t("money.importAutoStatusNeverRan", { source: label }));
    if (scheduled) lines.push(scheduled);
    return { lines, tone: "idle" };
  }

  if (source.last_result === "error") {
    lines.push(
      t("money.importAutoStatusLastFailed", {
        date: formatMoment(source.last_run_at),
        error: source.last_error ?? "-",
      }),
    );
  } else if (source.last_run_origin === "manual") {
    // A manual import clears the backoff and buys the cooldown; it is not an automatic run.
    lines.push(t("money.importAutoStatusLastManualOk", { date: formatMoment(source.last_run_at) }));
  } else if (source.last_run_origin === "auto") {
    lines.push(t("money.importAutoStatusLastOk", { date: formatMoment(source.last_run_at) }));
  } else {
    // Written before the origin was recorded (0.1.10 and earlier): a manual import that reset
    // the backoff looks the same as an automatic run, so it is called neither.
    lines.push(
      t("money.importAutoStatusLastOkUnknownOrigin", { date: formatMoment(source.last_run_at) }),
    );
  }
  if (next) lines.push(next);
  if (scheduled) lines.push(scheduled);
  return { lines, tone: source.last_result === "error" ? "error" : "ok" };
}

interface MoneyImportAutoStatusProps {
  t: Translate;
  /** "unavailable": the extension answered the ping but not the status request -- too old, or slow. */
  state: "loading" | "inactive" | "unavailable" | "ready";
  status: ExtensionAutoStatus | null;
  /** The person the page is showing; a key held for someone else is not this person's. */
  selectedPersonId: string | null;
  /** Localized names for the extension sources, by source id. */
  sourceLabels: Record<string, string>;
  onRefresh: () => void;
  /** Hands a new schedule to the extension; resolves with what it kept, or null. */
  onScheduleChange?: (schedule: ImportAutoSchedule) => Promise<ImportAutoSchedule | null>;
}

const SCHEDULE_KINDS: Array<ImportAutoSchedule["kind"]> = ["days", "week", "month"];

/**
 * The frequency setting: days, a week or a month, then how many days or which edge. A change
 * goes to the extension at once; what it kept is what the panel shows, so a rejected value
 * cannot sit on screen looking saved.
 */
function ImportAutoScheduleEditor({
  t,
  schedule,
  onChange,
}: {
  t: Translate;
  schedule: ImportAutoSchedule;
  onChange: (schedule: ImportAutoSchedule) => Promise<ImportAutoSchedule | null>;
}) {
  const [current, setCurrent] = React.useState(schedule);
  const [saving, setSaving] = React.useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [daysDraft, setDaysDraft] = React.useState(
    schedule.kind === "days" ? String(schedule.every) : "1",
  );
  React.useEffect(() => {
    setCurrent(schedule);
    if (schedule.kind === "days") setDaysDraft(String(schedule.every));
  }, [schedule]);

  const save = async (next: ImportAutoSchedule) => {
    setCurrent(next);
    setSaving("saving");
    const kept = await onChange(next);
    if (!kept) {
      setCurrent(schedule);
      setSaving("failed");
      return;
    }
    setCurrent(kept);
    if (kept.kind === "days") setDaysDraft(String(kept.every));
    setSaving("saved");
  };

  const pickKind = (kind: ImportAutoSchedule["kind"]) => {
    if (kind === current.kind) return;
    void save(
      kind === "days"
        ? { kind, every: Math.max(1, Number.parseInt(daysDraft, 10) || 1) }
        : { kind, at: current.kind === "days" ? "start" : current.at },
    );
  };

  const commitDays = () => {
    const every = Math.min(
      IMPORT_SCHEDULE_MAX_DAYS,
      Math.max(1, Number.parseInt(daysDraft, 10) || 1),
    );
    setDaysDraft(String(every));
    if (current.kind === "days" && current.every === every) return;
    void save({ kind: "days", every });
  };

  const pill = (active: boolean) =>
    `rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
      active
        ? "border-foreground bg-foreground text-background"
        : "border-border text-foreground hover:bg-muted"
    }`;

  return (
    <div className="space-y-2" data-testid="money-import-auto-schedule">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{t("money.importScheduleTitle")}</span>
        {saving !== "idle" && (
          <span
            className={`text-xs ${saving === "failed" ? "text-destructive" : "text-muted-foreground"}`}
          >
            {t(
              saving === "saving"
                ? "money.importScheduleSaving"
                : saving === "saved"
                  ? "money.importScheduleSaved"
                  : "money.importScheduleFailed",
            )}
          </span>
        )}
      </div>
      <div
        className="flex flex-wrap gap-1.5"
        role="group"
        aria-label={t("money.importScheduleTitle")}
      >
        {SCHEDULE_KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            className={pill(current.kind === kind)}
            aria-pressed={current.kind === kind}
            onClick={() => pickKind(kind)}
          >
            {t(`money.importScheduleKind_${kind}`)}
          </button>
        ))}
      </div>
      {current.kind === "days" ? (
        <label className="flex items-center gap-2 text-muted-foreground">
          {t("money.importScheduleEvery")}
          <Input
            type="number"
            inputMode="numeric"
            min={1}
            max={IMPORT_SCHEDULE_MAX_DAYS}
            value={daysDraft}
            onChange={(event) => setDaysDraft(event.target.value)}
            onBlur={commitDays}
            onKeyDown={(event) => {
              if (event.key === "Enter") commitDays();
            }}
            className="h-8 w-16 text-center"
            aria-label={t("money.importScheduleDaysLabel")}
          />
          {t("money.importScheduleDaysUnit", { count: Number.parseInt(daysDraft, 10) || 1 })}
        </label>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {(["start", "end"] as const).map((edge) => (
            <button
              key={edge}
              type="button"
              className={pill(current.at === edge)}
              aria-pressed={current.at === edge}
              onClick={() => {
                if (current.at !== edge) void save({ kind: current.kind, at: edge });
              }}
            >
              {t(`money.importSchedule_${current.kind}_${edge}`)}
            </button>
          ))}
        </div>
      )}
      <p className="text-xs text-muted-foreground">{t(scheduleHintKey(current))}</p>
    </div>
  );
}

function scheduleHintKey(schedule: ImportAutoSchedule): string {
  return schedule.kind === "days"
    ? "money.importScheduleHint_days"
    : `money.importScheduleHint_${schedule.kind}_${schedule.at}`;
}

export function MoneyImportAutoStatus({
  t,
  state,
  status,
  selectedPersonId,
  sourceLabels,
  onRefresh,
  onScheduleChange,
  children,
}: MoneyImportAutoStatusProps & { children?: React.ReactNode }) {
  const grant = status?.grant ?? null;
  const grantIsForSelectedPerson = Boolean(grant && grant.person_id === selectedPersonId);
  return (
    <Card className="rounded-xl" data-testid="money-import-auto-status">
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">{t("money.importAutoStatusTitle")}</CardTitle>
        <Button type="button" size="sm" variant="ghost" onClick={onRefresh}>
          {t("common.refresh")}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {state === "loading" && (
          <p className="text-muted-foreground">{t("money.importExtensionChecking")}</p>
        )}
        {state === "inactive" && (
          <p className="text-muted-foreground">{t("money.importAutoStatusExtensionInactive")}</p>
        )}
        {state === "unavailable" && (
          <p className="text-muted-foreground">{t("money.importAutoStatusUnavailable")}</p>
        )}
        {state === "ready" && !grant && (
          <p className="text-muted-foreground">{t("money.importAutoStatusNoGrant")}</p>
        )}
        {state === "ready" && grant && !grantIsForSelectedPerson && (
          <p className="text-muted-foreground" data-testid="money-import-auto-status-other-person">
            {t("money.importAutoStatusGrantOtherPerson", { date: formatMoment(grant.received_at) })}
          </p>
        )}
        {state === "ready" && grant && grantIsForSelectedPerson && (
          <>
            <p className="text-muted-foreground">
              {t("money.importAutoStatusGrantHeld", {
                date: formatMoment(grant.received_at),
                sources: grant.allowed_sources
                  .map((sourceId) => sourceLabels[sourceId] ?? sourceId)
                  .join(", "),
              })}
            </p>
            {onScheduleChange &&
              (status?.schedule ? (
                <ImportAutoScheduleEditor
                  t={t}
                  schedule={status.schedule}
                  onChange={onScheduleChange}
                />
              ) : (
                <p
                  className="text-muted-foreground"
                  data-testid="money-import-auto-schedule-update"
                >
                  {t("money.importScheduleNeedsUpdate")}
                </p>
              ))}
            {status?.sources.map((source) => {
              const label = sourceLabels[source.source_id] ?? source.source_id;
              const described = describeSource(source, label, t);
              return (
                <div
                  key={source.source_id}
                  className="space-y-0.5 rounded-md border px-3 py-2"
                  data-testid={`money-import-auto-status-${source.source_id}`}
                  data-tone={described.tone}
                >
                  <div className="font-medium">{label}</div>
                  {described.lines.map((line) => (
                    <p
                      key={line}
                      className={
                        described.tone === "error" ? "text-destructive" : "text-muted-foreground"
                      }
                    >
                      {line}
                    </p>
                  ))}
                </div>
              );
            })}
          </>
        )}
        {children ? <div className="border-t pt-3">{children}</div> : null}
      </CardContent>
    </Card>
  );
}
