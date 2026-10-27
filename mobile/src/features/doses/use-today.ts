import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { msUntilNextLocalDay } from "./day";

function startOfDay(day: Date): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate());
}

/**
 * Today's local midnight, kept current under a mounted screen.
 *
 * A day ends under a mounted screen in two ways on a phone: backgrounded overnight, or left open past
 * midnight. Both move "today", so a screen does not keep yesterday under today's heading.
 */
export function useToday(): Date {
  const [today, setToday] = useState(() => startOfDay(new Date()));
  useEffect(() => {
    const refresh = () => setToday(startOfDay(new Date()));
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        refresh();
      }
    });
    const timer = setTimeout(refresh, msUntilNextLocalDay(new Date()));
    return () => {
      subscription.remove();
      clearTimeout(timer);
    };
  }, [today]);
  return today;
}
