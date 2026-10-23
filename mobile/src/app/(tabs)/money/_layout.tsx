import { Stack } from "expo-router";
import { stackOptions } from "@/components/stack-options";

/** "Деньги": the transactions feed, a transaction, the accounts, the categories; the forms slide up over them. */
export default function MoneyStack() {
  return (
    <Stack screenOptions={stackOptions}>
      <Stack.Screen name="index" />
      <Stack.Screen name="form" options={{ presentation: "modal" }} />
      <Stack.Screen name="accounts/form" options={{ presentation: "modal" }} />
      <Stack.Screen name="accounts/card" options={{ presentation: "modal" }} />
      <Stack.Screen name="categories/form" options={{ presentation: "modal" }} />
    </Stack>
  );
}
