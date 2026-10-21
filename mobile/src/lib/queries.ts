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
