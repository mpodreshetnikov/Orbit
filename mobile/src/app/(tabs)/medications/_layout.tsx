import { Stack } from "expo-router";
import { stackOptions } from "@/components/stack-options";

/** "Лекарства": the list (declared first: a stack opens on it), a course, its history, its form. */
export default function MedicationsStack() {
  return (
    <Stack screenOptions={stackOptions}>
      <Stack.Screen name="index" />
      <Stack.Screen name="new" options={{ presentation: "modal" }} />
      <Stack.Screen name="[id]/edit" options={{ presentation: "modal" }} />
    </Stack>
  );
}
