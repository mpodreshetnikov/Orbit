import { Stack } from "expo-router";
import { stackOptions } from "@/components/stack-options";

/** "Здоровье": the health sections; mark-done slides up over them. */
export default function HealthStack() {
  return (
    <Stack screenOptions={stackOptions}>
      <Stack.Screen name="index" />
      <Stack.Screen name="checkups/complete" options={{ presentation: "modal" }} />
    </Stack>
  );
}
