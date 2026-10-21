import type { Stack } from "expo-router";
import type { ComponentProps } from "react";
import { font } from "@/theme";

type StackOptions = NonNullable<ComponentProps<typeof Stack>["screenOptions"]>;

/**
 * Every tab's stack: iOS large titles that collapse into the bar on scroll, set in Geist like the
 * rest. The colours come from the navigation theme the root layout sets.
 */
export const stackOptions: StackOptions = {
  headerLargeTitle: true,
  headerLargeTitleShadowVisible: false,
  headerShadowVisible: false,
  headerTitleStyle: { fontFamily: font.semibold },
  headerLargeTitleStyle: { fontFamily: font.bold },
  headerBackButtonDisplayMode: "minimal",
};
