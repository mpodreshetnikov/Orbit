import { QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import type { CheckupItem, CheckupItemStatus } from "@orbit-types/checkup";
import type { checkupColumns } from "@orbit-types/checkup-form";
import type { UpdateConditionInput } from "@orbit-types/condition";
import type { FindingSummary } from "@orbit-types/finding";
import { toggleHiddenCode, type HiddenMeasurementCodes } from "@orbit-types/measurement-visibility";
import type {
  AddOneTimeToExistingPayload,
  CreateMedRegimenInput,
  MedRegimen,
} from "@orbit-types/regimen";
import type { CourseColumns } from "@orbit-types/regimen-form";
import { withStatus } from "@/features/doses/dashboard";
import type { DayDose, DoseStatus } from "@/features/doses/model";
import {
  fetchDoseHistory,
  fetchDosesForDay,
  markDoseSkipped,
  markDoseTaken,
  resolveOwnPerson,
  undoDoseIntake,
} from "@/features/doses/query";
import {
  archiveRegimen,
  changeStock,
  deleteRegimen,
  fetchOverdueInterval,
  fetchRefillSnooze,
  saveOverdueInterval,
  setRefillSnooze,
  unarchiveRegimen,
} from "@/features/medications/actions";
import { fetchRegimen, fetchRegimens } from "@/features/medications/query";
import {
  deleteCondition,
  fetchCondition,
  fetchConditions,
  lookupIcdCode,
  updateCondition,
} from "@/features/conditions/query";
import { addConditionHistory, type HistoryEntry } from "@/features/conditions/history";
import {
  completeCheckup,
  fetchCheckups,
  fetchCompletions,
  planCheckup,
  saveCheckup,
  saveCompletion,
  setCheckupStatus,
  type Completion,
} from "@/features/checkups/query";
import { fetchObservations } from "@/features/observations/query";
import {
  fetchClinicalCatalog,
  saveClinicalEntry,
  type ClinicalCatalogKind,
  type ClinicalColumns,
} from "@/features/catalogs/query";
import { fetchActiveRecords, fetchFindings, markFindingResolved } from "@/features/findings/query";
import {
  createCatalogEntry,
  createMeasurement,
  deleteCatalogEntry,
  deleteMeasurement,
  fetchHiddenCodes,
  fetchMeasurementCatalog,
  fetchMeasurements,
  saveHiddenCodes,
  updateCatalogEntry,
  updateMeasurement,
  type CatalogColumns,
  type MeasurementEntry,
} from "@/features/measurements/query";
import { saveEditedCourse, saveNewCourse } from "@/features/medications/save";
import { useSession } from "@/lib/session";

/**
 * One cache for the app, so the tabs share what they have loaded: a dose marked taken on "Сегодня"
 * is already taken in a course's history when that screen is pushed, without a second request.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
  },
});

export function usePerson() {
  const { session } = useSession();
  const userId = session?.user.id;
  return useQuery({
    queryKey: ["person", userId],
    queryFn: () => resolveOwnPerson(userId),
    enabled: Boolean(userId),
    staleTime: Infinity,
  });
}

/** `YYYY-MM-DD` in local time: a day's cache key, and the same day however it was reached. */
export function dayKey(day: Date): string {
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
}

export function useDayDoses(personId: string | undefined, day: Date) {
  return useQuery({
    queryKey: ["doses-day", personId, dayKey(day)],
    queryFn: () => fetchDosesForDay(personId as string, day),
    enabled: Boolean(personId),
  });
}

export function useRegimens(personId: string | undefined) {
  return useQuery({
    queryKey: ["regimens", personId],
    queryFn: () => fetchRegimens(personId as string),
    enabled: Boolean(personId),
  });
}

export function useRegimen(regimenId: string) {
  return useQuery({
    queryKey: ["regimen", regimenId],
    queryFn: () => fetchRegimen(regimenId),
  });
}

export function useDoseHistory(regimenId: string) {
  return useQuery({
    queryKey: ["dose-history", regimenId],
    queryFn: () => fetchDoseHistory(regimenId),
  });
}

export type DoseAction = "take" | "skip" | "undo";

const RESULT: Record<DoseAction, DoseStatus> = {
  take: "taken",
  skip: "skipped",
  // What `undo_dose_intake` puts a dose back to.
  undo: "scheduled",
};

type DoseLists = [readonly unknown[], DayDose[] | undefined][];

/**
 * Take, skip or undo a dose, with the answer drawn before the server gives it.
 *
 * The row changes the moment it is tapped and the phone confirms it with a haptic: a success tap for
 * taken, a light one for skipped. Every cached list holding the dose — the day it is on and the
 * course's history — is updated in place; if the server refuses, they are put back and the phone
 * buzzes an error, so a failure is felt rather than silently undone. Afterwards the lists are
 * refetched, and so are the courses, since taking a dose can move a course's stock.
 */
export function useDoseAction() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ dose, action, at }: { dose: DayDose; action: DoseAction; at: string }) => {
      if (action === "take") {
        await markDoseTaken(dose.id, at);
      } else if (action === "skip") {
        await markDoseSkipped(dose.id);
      } else {
        await undoDoseIntake(dose.id);
      }
    },
    onMutate: async ({ dose, action, at }) => {
      void (action === "take"
        ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
        : Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
      await client.cancelQueries({ queryKey: ["doses-day"] });
      await client.cancelQueries({ queryKey: ["dose-history"] });
      const before: DoseLists = [
        ...client.getQueriesData<DayDose[]>({ queryKey: ["doses-day"] }),
        ...client.getQueriesData<DayDose[]>({ queryKey: ["dose-history"] }),
      ];
      const takenAt = action === "take" ? at : null;
      for (const [key, list] of before) {
        if (list?.some((one) => one.id === dose.id)) {
          client.setQueryData(key, withStatus(list, dose.id, RESULT[action], takenAt));
        }
      }
      return { before };
    },
    onError: (_error, _variables, context) => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      for (const [key, list] of context?.before ?? []) {
        client.setQueryData(key, list);
      }
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ["doses-day"] });
      void client.invalidateQueries({ queryKey: ["dose-history"] });
      void client.invalidateQueries({ queryKey: ["regimens"] });
      void client.invalidateQueries({ queryKey: ["regimen"] });
    },
  });
}

/** Everything a change to a course can show up in: the lists, the course, and its doses. */
function refreshCourses(client: QueryClient) {
  void client.invalidateQueries({ queryKey: ["regimens"] });
  void client.invalidateQueries({ queryKey: ["regimen"] });
  void client.invalidateQueries({ queryKey: ["doses-day"] });
  void client.invalidateQueries({ queryKey: ["dose-history"] });
}

export type CourseChange = "archive" | "unarchive" | "delete";

const COURSE_CHANGES: Record<CourseChange, (regimenId: string) => Promise<void>> = {
  archive: archiveRegimen,
  unarchive: unarchiveRegimen,
  delete: deleteRegimen,
};

/** Archive, bring back or delete a course; a failure buzzes, as a dose's does. */
export function useCourseChange() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ regimenId, change }: { regimenId: string; change: CourseChange }) =>
      COURSE_CHANGES[change](regimenId),
    onSuccess: () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
    onError: () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
    onSettled: () => refreshCourses(client),
  });
}

/** Refill a course's stock, or write some off. */
export function useChangeStock() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ regimenId, amount }: { regimenId: string; amount: number }) =>
      changeStock(regimenId, amount),
    onSuccess: () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
    onError: () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
    onSettled: () => refreshCourses(client),
  });
}

export function useRefillSnooze(regimenId: string) {
  return useQuery({
    queryKey: ["refill-snooze", regimenId],
    queryFn: () => fetchRefillSnooze(regimenId),
  });
}

export function useSetRefillSnooze() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ regimenId, until }: { regimenId: string; until: string | null }) =>
      setRefillSnooze(regimenId, until),
    onError: () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
    onSettled: (_data, _error, { regimenId }) => {
      void client.invalidateQueries({ queryKey: ["refill-snooze", regimenId] });
      void client.invalidateQueries({ queryKey: ["regimens"] });
    },
  });
}

export function useOverdueInterval() {
  const { session } = useSession();
  const userId = session?.user.id;
  return useQuery({
    queryKey: ["overdue-interval", userId],
    queryFn: () => fetchOverdueInterval(userId as string),
    enabled: Boolean(userId),
  });
}

export function useSaveOverdueInterval() {
  const client = useQueryClient();
  const { session } = useSession();
  const userId = session?.user.id;
  return useMutation({
    mutationFn: (minutes: number) => saveOverdueInterval(userId as string, minutes),
    onSuccess: (value) => client.setQueryData(["overdue-interval", userId], value),
    onError: () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
  });
}

export type CourseSave =
  | { personId: string; submission: CreateMedRegimenInput | AddOneTimeToExistingPayload }
  | { course: MedRegimen; columns: CourseColumns };

/** Create or edit a course from its form; resolves to the course to show afterwards. */
export function useSaveCourse() {
  const client = useQueryClient();
  const { session } = useSession();
  const userId = session?.user.id as string;
  return useMutation({
    mutationFn: async (save: CourseSave) => {
      if ("submission" in save) return saveNewCourse(userId, save.personId, save.submission);
      await saveEditedCourse(userId, save.course, save.columns);
      return save.course.id;
    },
    onSuccess: () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
    onError: () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
    onSettled: () => refreshCourses(client),
  });
}

export function useMeasurements(personId: string | undefined) {
  return useQuery({
    queryKey: ["measurements", personId],
    queryFn: () => fetchMeasurements(personId as string),
    enabled: Boolean(personId),
  });
}

export function useMeasurementCatalog() {
  return useQuery({ queryKey: ["measurement-catalog"], queryFn: fetchMeasurementCatalog });
}

export function useClinicalCatalog(kind: ClinicalCatalogKind) {
  return useQuery({
    queryKey: ["clinical-catalog", kind],
    queryFn: () => fetchClinicalCatalog(kind),
  });
}

/** Add, change or delete (`columns: null`) a finding type or body site; findings carry their names. */
export function useSaveClinicalEntry(kind: ClinicalCatalogKind) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, columns }: { id?: string; columns: ClinicalColumns | null }) =>
      saveClinicalEntry(kind, id, columns),
    onSuccess: () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
    onError: () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ["clinical-catalog", kind] });
      void client.invalidateQueries({ queryKey: ["findings"] });
    },
  });
}

export type CatalogSave = { columns: CatalogColumns; id?: string } | { id: string; remove: true };

/**
 * Add, change or delete a catalogue entry. A person's measurements carry the entry's names, so they
 * are refetched with the catalogue.
 */
export function useSaveCatalogEntry() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (save: CatalogSave) => {
      if ("remove" in save) return deleteCatalogEntry(save.id);
      if (save.id) return updateCatalogEntry(save.id, save.columns);
      return createCatalogEntry(save.columns);
    },
    onSuccess: () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
    onError: () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ["measurement-catalog"] });
      void client.invalidateQueries({ queryKey: ["measurements"] });
    },
  });
}

export type MeasurementSave =
  | { personId: string; catalogId: string; entry: MeasurementEntry }
  | { id: string; entry: MeasurementEntry }
  | { id: string; remove: true };

/** Record, correct or delete one measurement; the person's list is refetched after. */
export function useSaveMeasurement() {
  const client = useQueryClient();
  const { session } = useSession();
  const userId = session?.user.id as string;
  return useMutation({
    mutationFn: async (save: MeasurementSave) => {
      if ("remove" in save) return deleteMeasurement(save.id);
      if ("personId" in save) {
        return createMeasurement(userId, save.personId, save.catalogId, save.entry);
      }
      return updateMeasurement(save.id, save.entry);
    },
    onSuccess: () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
    onError: () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
    onSettled: () => void client.invalidateQueries({ queryKey: ["measurements"] }),
  });
}

/**
 * The types hidden from one person's list, and a toggle — the web app's `useHiddenMeasurements`.
 *
 * The preference is one jsonb blob read-modify-written whole, so each toggle builds on the cache the
 * previous toggle already changed rather than on the server's last answer, and the writes queue in
 * one scope so they reach the server in the order they were made. A failed write refetches.
 */
export function useHiddenMeasurements(personId: string | undefined) {
  const client = useQueryClient();
  const { session } = useSession();
  const userId = session?.user.id;
  const key = ["hidden-measurements", userId];
  const hidden = useQuery({
    queryKey: key,
    queryFn: () => fetchHiddenCodes(userId as string),
    enabled: Boolean(userId),
  });
  const save = useMutation({
    mutationFn: (next: HiddenMeasurementCodes) => saveHiddenCodes(userId as string, next),
    scope: { id: "hidden-measurements" },
    onError: () => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      void client.invalidateQueries({ queryKey: key });
    },
  });
  const codes = new Set(personId ? (hidden.data?.[personId] ?? []) : []);
  // The column is written whole, so a toggle waits for the stored choices: one built on nothing
  // would wipe the types hidden for every other person.
  const toggle = (code: string) => {
    const current = client.getQueryData<HiddenMeasurementCodes>(key);
    if (!personId || !current) return;
    const next = toggleHiddenCode(current, personId, code);
    client.setQueryData(key, next);
    save.mutate(next);
  };
  return {
    codes,
    toggle,
    ready: hidden.data !== undefined,
    pending: hidden.isPending,
    error: hidden.error,
  };
}

export function useObservations(personId: string | undefined) {
  return useQuery({
    queryKey: ["observations", personId],
    queryFn: () => fetchObservations(personId as string),
    enabled: Boolean(personId),
  });
}

export function useFindings(personId: string | undefined) {
  return useQuery({
    queryKey: ["findings", personId],
    queryFn: () => fetchFindings(personId as string),
    enabled: Boolean(personId),
  });
}

export function useActiveRecords(personId: string | undefined) {
  return useQuery({
    queryKey: ["active-records", personId],
    queryFn: () => fetchActiveRecords(personId as string),
    enabled: Boolean(personId),
  });
}

/** Mark a finding gone, on a record of the person's; the findings are refetched after. */
export function useMarkFindingResolved() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { personId: string; recordId: string; finding: FindingSummary }) =>
      markFindingResolved(input.personId, input.recordId, input.finding),
    onSuccess: () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
    onError: () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
    onSettled: () => void client.invalidateQueries({ queryKey: ["findings"] }),
  });
}

export function useConditions(personId: string | undefined) {
  return useQuery({
    queryKey: ["conditions", personId],
    queryFn: () => fetchConditions(personId as string),
    enabled: Boolean(personId),
  });
}

export function useCondition(id: string) {
  return useQuery({ queryKey: ["condition", id], queryFn: () => fetchCondition(id) });
}

/** An ICD-10 code's official names, once two characters are typed; codes never change. */
export function useIcdLookup(code: string) {
  return useQuery({
    queryKey: ["icd-lookup", code],
    queryFn: () => lookupIcdCode(code),
    enabled: code.length >= 2,
    staleTime: Infinity,
  });
}

/** Edit a condition, or delete it with `remove`; the list and the condition are refetched. */
export function useSaveCondition() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string } & ({ values: UpdateConditionInput } | { remove: true })) =>
      "values" in input ? updateCondition(input.id, input.values) : deleteCondition(input.id),
    onSuccess: () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
    onSettled: (_data, _error, input) => {
      void client.invalidateQueries({ queryKey: ["conditions"] });
      void client.invalidateQueries({ queryKey: ["condition", input.id] });
    },
  });
}

/** Add a mention to a condition's history by hand; the condition and the list are refetched. */
export function useAddConditionHistory() {
  const client = useQueryClient();
  const { session } = useSession();
  return useMutation({
    mutationFn: (entry: HistoryEntry) => addConditionHistory(session?.user.id as string, entry),
    onSuccess: () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
    onSettled: (_data, _error, entry) => {
      void client.invalidateQueries({ queryKey: ["conditions"] });
      void client.invalidateQueries({ queryKey: ["condition", entry.conditionId] });
    },
  });
}

export function useCheckups(personId: string | undefined) {
  return useQuery({
    queryKey: ["checkups", personId],
    queryFn: () => fetchCheckups(personId as string),
    enabled: Boolean(personId),
  });
}

/**
 * Everything done to a checkup: create or edit it, mark it done, plan it, change its status or
 * delete it, correct or delete a completion. The checkups and their completions are refetched after.
 */
export function useCheckupAction() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (
      input:
        | { item: CheckupItem; completion: Completion }
        | { item: CheckupItem; plannedOn: string | null }
        | { item: CheckupItem; status: CheckupItemStatus | null }
        | { completionId: string; completion: Completion | null }
        | { personId: string; id?: string; columns: ReturnType<typeof checkupColumns> },
    ) => {
      if ("columns" in input) return saveCheckup(input.personId, input.id, input.columns);
      if ("completionId" in input) return saveCompletion(input.completionId, input.completion);
      if ("completion" in input) return completeCheckup(input.item, input.completion);
      if ("plannedOn" in input) return planCheckup(input.item.id, input.plannedOn);
      return setCheckupStatus(input.item.id, input.status);
    },
    onSuccess: () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ["checkups"] });
      void client.invalidateQueries({ queryKey: ["completions"] });
    },
  });
}

export function useCompletions(itemId: string) {
  return useQuery({ queryKey: ["completions", itemId], queryFn: () => fetchCompletions(itemId) });
}
