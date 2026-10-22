import { QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
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
