import { Stack } from "expo-router";
import { stackOptions } from "@/components/stack-options";

/** "Сегодня": the day's doses, the courses they belong to pushed on top, and a course's form over those. */
export default function TodayStack() {
  return (
    <Stack screenOptions={stackOptions}>
      <Stack.Screen name="medication/[id]/edit" options={{ presentation: "modal" }} />
    </Stack>
  );
}
