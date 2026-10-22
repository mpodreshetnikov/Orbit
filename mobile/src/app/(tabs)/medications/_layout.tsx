import { Stack } from "expo-router";
import { stackOptions } from "@/components/stack-options";

/** "Лекарства": every course, one course, and its history; a course's form slides up over them. */
export default function MedicationsStack() {
  return (
    <Stack screenOptions={stackOptions}>
      <Stack.Screen name="new" options={{ presentation: "modal" }} />
      <Stack.Screen name="[id]/edit" options={{ presentation: "modal" }} />
    </Stack>
  );
}
