import { useCallback, useEffect, useRef, useState } from "react";
import type { DoseAction, useDoseAction } from "@/lib/queries";
import type { DayDose } from "./model";

/** How long a dose acted on stays in place, showing its new state, before it moves to the completed
 * section. The web dashboard's five seconds, restarted by every tap. */
const SETTLE_MS = 5000;

/**
 * Answers a dose at once and remembers it as just acted on for a moment, so its row shows the answer
 * before it folds away with the day's settled doses.
 */
export function useSettledDoses(action: ReturnType<typeof useDoseAction>) {
  const [recentlyActed, setRecentlyActed] = useState<ReadonlySet<string>>(new Set());
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (settleTimer.current) {
        clearTimeout(settleTimer.current);
      }
    },
    [],
  );

  const act = useCallback(
    (dose: DayDose, kind: DoseAction) => {
      setRecentlyActed((previous) => new Set(previous).add(dose.id));
      if (settleTimer.current) {
        clearTimeout(settleTimer.current);
      }
      settleTimer.current = setTimeout(() => setRecentlyActed(new Set()), SETTLE_MS);
      action.mutate({ dose, action: kind, at: new Date().toISOString() });
    },
    [action],
  );

  return { recentlyActed, act };
}
