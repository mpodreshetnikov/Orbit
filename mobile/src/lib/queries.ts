import {
  keepPreviousData,
  QueryClient,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import type { CheckupItem, CheckupItemStatus } from "@orbit-types/checkup";
import { importStillSettling } from "@orbit-types/money-import-review";
import type { RoutingChoice } from "@orbit-types/notification-routing";
import type { MoneyTransactionFeedFilters } from "@orbit-types/money";
import { withStatus } from "@/features/doses/dashboard";
import { readTodayBlocks, writeTodayBlocks, type TodayBlocks } from "@/features/today/blocks";
import {
  attachmentLink,
  fetchAttachments,
  fetchRecord,
  fetchRecordFindings,
  fetchRecordObservations,
  fetchRecords,
} from "@/features/records/query";
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
import { deleteCondition, fetchCondition, fetchConditions } from "@/features/conditions/query";
import {
  completeCheckup,
  fetchCheckups,
  fetchCompletions,
  saveCompletion,
  setCheckupStatus,
  type Completion,
} from "@/features/checkups/query";
import { fetchObservations } from "@/features/observations/query";
import {
  fetchMoneyAccounts,
  fetchMoneyCategories,
  fetchMoneyFeedPage,
  fetchMoneyFeedSummary,
} from "@/features/money/query";
import { fetchTransaction } from "@/features/money/transactions";
import {
  fetchImportBatch,
  fetchImportBatches,
  moneyImportAction,
  rollbackImportBatch,
} from "@/features/money/import";
import {
  fetchCheckupReminders,
  fetchHousehold,
  fetchRouting,
  readChosenPerson,
  saveCheckupReminders,
  saveRouting,
  writeChosenPerson,
  type CheckupReminders,
} from "@/features/settings";
import { fetchSpendingReport, type SpendingReportQuery } from "@/features/money/reports";
import { fetchActiveRecords, fetchFindings } from "@/features/findings/query";
import { fetchHiddenCodes, fetchMeasurements } from "@/features/measurements/query";
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
    queryFn: async () => resolveOwnPerson(userId, await readChosenPerson(userId!)),
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

export function useMeasurements(personId: string | undefined) {
  return useQuery({
    queryKey: ["measurements", personId],
    queryFn: () => fetchMeasurements(personId as string),
    enabled: Boolean(personId),
  });
}

/** The types hidden from one person's list (read-only — visibility edits are agent-side). */
export function useHiddenMeasurements(personId: string | undefined) {
  const { session } = useSession();
  const userId = session?.user.id;
  const hidden = useQuery({
    queryKey: ["hidden-measurements", userId],
    queryFn: () => fetchHiddenCodes(userId as string),
    enabled: Boolean(userId),
  });
  const codes = new Set(personId ? (hidden.data?.[personId] ?? []) : []);
  return {
    codes,
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

/** Delete a condition; the list and the condition are refetched. */
export function useSaveCondition() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; remove: true }) => deleteCondition(input.id),
    onSuccess: () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
    onSettled: (_data, _error, input) => {
      void client.invalidateQueries({ queryKey: ["conditions"] });
      void client.invalidateQueries({ queryKey: ["condition", input.id] });
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
 * Mark a checkup done, change its status, or correct/delete a completion.
 * Create/edit/plan forms are agent-side.
 */
export function useCheckupAction() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (
      input:
        | { item: CheckupItem; completion: Completion }
        | { item: CheckupItem; status: CheckupItemStatus | null }
        | { completionId: string; completion: Completion | null },
    ) => {
      if ("completionId" in input) return saveCompletion(input.completionId, input.completion);
      if ("completion" in input) return completeCheckup(input.item, input.completion);
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

/** The person's transactions, a page at a time, under the web feed's filters. */
export function useMoneyFeed(personId: string | undefined, filters: MoneyTransactionFeedFilters) {
  return useInfiniteQuery({
    queryKey: ["money-feed", personId, filters],
    queryFn: ({ pageParam }) => fetchMoneyFeedPage(personId!, filters, pageParam),
    initialPageParam: 0,
    getNextPageParam: (page) => page.nextOffset,
    enabled: !!personId,
  });
}

export function useMoneyFeedSummary(
  personId: string | undefined,
  filters: MoneyTransactionFeedFilters,
) {
  return useQuery({
    queryKey: ["money-feed-summary", personId, filters],
    queryFn: () => fetchMoneyFeedSummary(personId!, filters),
    enabled: !!personId,
  });
}

export function useMoneyAccounts(personId: string | undefined) {
  return useQuery({
    queryKey: ["money-accounts", personId],
    queryFn: () => fetchMoneyAccounts(personId!),
    enabled: !!personId,
  });
}

export function useMoneyCategories() {
  return useQuery({ queryKey: ["money-categories"], queryFn: fetchMoneyCategories });
}

export function useTransaction(id: string) {
  return useQuery({ queryKey: ["money-transaction", id], queryFn: () => fetchTransaction(id) });
}

/** The spending report; while a new period or filter loads, the last one stays on screen. */
export function useSpendingReport(
  query: Omit<SpendingReportQuery, "personId"> & {
    personId: string | undefined;
  },
) {
  const { personId, period, currency, accountIds, categoryId } = query;
  return useQuery({
    queryKey: [
      "money-spending-report",
      personId,
      period.start,
      period.end,
      currency,
      [...accountIds].sort().join(","),
      categoryId,
    ],
    queryFn: () => fetchSpendingReport({ ...query, personId: personId! }),
    enabled: !!personId,
    placeholderData: keepPreviousData,
  });
}

export function useImportBatches(personId: string | undefined) {
  return useQuery({
    queryKey: ["money-import-batches", personId],
    queryFn: () => fetchImportBatches(personId!),
    enabled: !!personId,
  });
}

/** How often a batch still being read is asked again, so its screen follows the import live. */
const RUNNING_IMPORT_REFRESH_MS = 3000;

export function useImportBatch(id: string) {
  return useQuery({
    queryKey: ["money-import-batch", id],
    queryFn: () => fetchImportBatch(id),
    refetchInterval: (query) => {
      const batch = query.state.data?.batch;
      return batch && importStillSettling(batch, new Date()) ? RUNNING_IMPORT_REFRESH_MS : false;
    },
  });
}

/** Undo an applied import; the feed and the history follow. */
export function useRollbackImportBatch() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => rollbackImportBatch(id),
    onSuccess: () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
    onError: () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ["money-import-batch"] });
      void client.invalidateQueries({ queryKey: ["money-import-batches"] });
      void client.invalidateQueries({ queryKey: ["money-feed"] });
      void client.invalidateQueries({ queryKey: ["money-feed-summary"] });
    },
  });
}

/** Apply a batch's rows to the transactions, or mark it as not applied. */
export function useReviewImportBatch() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, apply }: { id: string; apply: boolean }) =>
      moneyImportAction({ action: apply ? "apply_batch" : "discard_batch", batch_id: id }),
    onSuccess: () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
    onError: () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ["money-import-batch"] });
      void client.invalidateQueries({ queryKey: ["money-import-batches"] });
      void client.invalidateQueries({ queryKey: ["money-feed"] });
      void client.invalidateQueries({ queryKey: ["money-feed-summary"] });
    },
  });
}

/** Switch the phone to another person of the household; every screen follows. */
export function useChoosePerson() {
  const client = useQueryClient();
  const { session } = useSession();
  const userId = session?.user.id;
  return useMutation({
    mutationFn: (personId: string) => writeChosenPerson(userId!, personId),
    onSuccess: () => void Haptics.selectionAsync(),
    onSettled: () => void client.invalidateQueries({ queryKey: ["person", userId] }),
  });
}

export function useHousehold() {
  return useQuery({ queryKey: ["household"], queryFn: fetchHousehold });
}

export function useNotificationSettings() {
  const { session } = useSession();
  const userId = session?.user.id;
  return useQuery({
    queryKey: ["notification-settings", userId],
    queryFn: async () => ({
      reminders: await fetchCheckupReminders(userId!),
      routing: await fetchRouting(userId!),
    }),
    enabled: Boolean(userId),
  });
}

export type NotificationSave = { reminders: CheckupReminders } | { routing: RoutingChoice };

/** Save the checkup reminder's time, or whose reminders reach the account. */
export function useSaveNotificationSettings() {
  const client = useQueryClient();
  const { session } = useSession();
  const userId = session?.user.id;
  return useMutation({
    mutationFn: (save: NotificationSave) =>
      "reminders" in save
        ? saveCheckupReminders(userId!, save.reminders)
        : saveRouting(userId!, save.routing),
    onSuccess: () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
    onError: () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
    onSettled: () => void client.invalidateQueries({ queryKey: ["notification-settings"] }),
  });
}

/** The blocks "Сегодня" shows on this phone. */
export function useTodayBlocks() {
  const { session } = useSession();
  const userId = session?.user.id;
  return useQuery({
    queryKey: ["today-blocks", userId],
    queryFn: () => readTodayBlocks(userId!),
    enabled: Boolean(userId),
    staleTime: Infinity,
  });
}

/** Show or hide blocks on "Сегодня"; the screen follows at once. */
export function useSaveTodayBlocks() {
  const client = useQueryClient();
  const { session } = useSession();
  const userId = session?.user.id;
  return useMutation({
    mutationFn: (blocks: TodayBlocks) => writeTodayBlocks(userId!, blocks),
    onMutate: (blocks) => client.setQueryData(["today-blocks", userId], blocks),
    onSuccess: () => void Haptics.selectionAsync(),
    onSettled: () => void client.invalidateQueries({ queryKey: ["today-blocks", userId] }),
  });
}

/** The person's approved documents, newest first. */
export function useRecords(personId: string | undefined) {
  return useQuery({
    queryKey: ["records", personId],
    queryFn: () => fetchRecords(personId!),
    enabled: Boolean(personId),
  });
}

/** One document with its pages, what was read from it, and what was found in it. */
export function useRecord(id: string) {
  const record = useQuery({ queryKey: ["record", id], queryFn: () => fetchRecord(id) });
  const attachments = useQuery({
    queryKey: ["record-attachments", id],
    queryFn: () => fetchAttachments(id),
  });
  const observations = useQuery({
    queryKey: ["record-observations", id],
    queryFn: () => fetchRecordObservations(id),
  });
  const findings = useQuery({
    queryKey: ["record-findings", id],
    queryFn: () => fetchRecordFindings(id),
  });
  return { record, attachments, observations, findings };
}

/** A link to open an attachment with, fetched when it is asked for. */
export function useAttachmentLink() {
  return useMutation({ mutationFn: (storagePath: string) => attachmentLink(storagePath) });
}
