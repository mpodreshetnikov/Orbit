import { Stack } from "expo-router";
import { stackOptions } from "@/components/stack-options";

/** "Деньги": the transactions feed. */
export default function MoneyStack() {
  return (
    <Stack screenOptions={stackOptions}>
      <Stack.Screen name="index" />
    </Stack>
  );
}
