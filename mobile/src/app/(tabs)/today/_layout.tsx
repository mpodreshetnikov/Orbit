import { Stack } from "expo-router";
import { stackOptions } from "@/components/stack-options";

/** "Сегодня": the day's doses, the courses they belong to pushed on top, a course's form and a
 * spend over those: the spend is one tap from a cold start. */
export default function TodayStack() {
  return (
    <Stack screenOptions={stackOptions}>
      <Stack.Screen name="index" />
      <Stack.Screen name="medication/[id]/edit" options={{ presentation: "modal" }} />
      <Stack.Screen name="spend" options={{ presentation: "modal" }} />
    </Stack>
  );
}
