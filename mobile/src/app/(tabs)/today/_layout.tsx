import { Stack } from "expo-router";
import { stackOptions } from "@/components/stack-options";

/** "Сегодня": the day's blocks, a dose's course pushed on top. */
export default function TodayStack() {
  return (
    <Stack screenOptions={stackOptions}>
      <Stack.Screen name="index" />
    </Stack>
  );
}
