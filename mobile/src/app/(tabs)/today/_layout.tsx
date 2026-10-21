import { Stack } from "expo-router";
import { stackOptions } from "@/components/stack-options";

/** "Сегодня": the day's doses, and the courses they belong to pushed on top. */
export default function TodayStack() {
  return <Stack screenOptions={stackOptions} />;
}
