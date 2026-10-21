import { Stack } from "expo-router";
import { stackOptions } from "@/components/stack-options";

/** "Лекарства": every course, one course, and its history. */
export default function MedicationsStack() {
  return <Stack screenOptions={stackOptions} />;
}
