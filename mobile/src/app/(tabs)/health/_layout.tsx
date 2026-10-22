import { Stack } from "expo-router";
import { stackOptions } from "@/components/stack-options";

/** "Здоровье": the health sections; a measurement's form slides up over them. */
export default function HealthStack() {
  return (
    <Stack screenOptions={stackOptions}>
      <Stack.Screen name="measurements/form" options={{ presentation: "modal" }} />
    </Stack>
  );
}
