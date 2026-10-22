import { Stack } from "expo-router";
import { stackOptions } from "@/components/stack-options";

/** "Деньги": the transactions feed, a transaction, and its form sliding up over them. */
export default function MoneyStack() {
  return (
    <Stack screenOptions={stackOptions}>
      <Stack.Screen name="index" />
      <Stack.Screen name="form" options={{ presentation: "modal" }} />
    </Stack>
  );
}
