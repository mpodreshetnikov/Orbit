import { Stack } from "expo-router";
import { stackOptions } from "@/components/stack-options";

/** "Здоровье": the health sections, and the screens each opens. */
export default function HealthStack() {
  return <Stack screenOptions={stackOptions} />;
}
