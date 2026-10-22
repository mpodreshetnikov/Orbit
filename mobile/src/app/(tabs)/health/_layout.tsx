import { Stack } from "expo-router";
import { stackOptions } from "@/components/stack-options";

/** "Здоровье": the health sections; the forms slide up over them. */
export default function HealthStack() {
  return (
    <Stack screenOptions={stackOptions}>
      <Stack.Screen name="index" />
      <Stack.Screen name="measurements/form" options={{ presentation: "modal" }} />
      <Stack.Screen name="catalogs/measurements/form" options={{ presentation: "modal" }} />
      <Stack.Screen name="conditions/edit" options={{ presentation: "modal" }} />
      <Stack.Screen name="conditions/history" options={{ presentation: "modal" }} />
    </Stack>
  );
}
