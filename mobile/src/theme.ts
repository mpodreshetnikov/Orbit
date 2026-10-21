import { useColorScheme } from "react-native";

/**
 * The web app's look, in the values React Native takes.
 *
 * The colours are the web app's own shadcn "neutral" tokens (`src/app/globals.css`), converted from
 * HSL, in both its light and dark sets; the status tints are the Tailwind shades its medication
 * components use. The type is Geist, the web app's font. A colour changed there is changed here by
 * hand — there is no build step between the two, so this file names where each value comes from.
 */
const light = {
  background: "#ffffff", // --background 0 0% 100%
  foreground: "#0a0a0a", // --foreground 0 0% 3.9%
  card: "#ffffff", // --card
  primary: "#171717", // --primary 0 0% 9%
  primaryForeground: "#fafafa", // --primary-foreground 0 0% 98%
  secondary: "#f5f5f5", // --secondary 0 0% 96.1%
  muted: "#f5f5f5", // --muted 0 0% 96.1%
  mutedHalf: "rgba(245, 245, 245, 0.5)", // bg-muted/50
  mutedForeground: "#737373", // --muted-foreground 0 0% 45.1%
  border: "#e5e5e5", // --border 0 0% 89.8%
  destructive: "#ef4444", // --destructive 0 84.2% 60.2%
  success: "#16a34a", // green-600
  successSurface: "#f0fdf4", // green-50
  successBorder: "#bbf7d0", // green-200
  warning: "#d97706", // amber-600
  warningText: "#b45309", // amber-700
  warningSurface: "#fffbeb", // amber-50
  warningBorder: "#fde68a", // amber-200
  activeText: "#047857", // emerald-700
  activeSurface: "rgba(16, 185, 129, 0.1)", // emerald-500/10
  activeBorder: "rgba(16, 185, 129, 0.2)", // emerald-500/20
  pausedSurface: "rgba(245, 158, 11, 0.1)", // amber-500/10
  pausedBorder: "rgba(245, 158, 11, 0.2)", // amber-500/20
  completedText: "#334155", // slate-700
  completedSurface: "rgba(100, 116, 139, 0.1)", // slate-500/10
  completedBorder: "rgba(100, 116, 139, 0.2)", // slate-500/20
};

export type Palette = typeof light;

const dark: Palette = {
  background: "#0a0a0a", // --background 0 0% 3.9%
  foreground: "#fafafa", // --foreground 0 0% 98%
  card: "#0a0a0a",
  primary: "#fafafa", // --primary 0 0% 98%
  primaryForeground: "#171717", // --primary-foreground 0 0% 9%
  secondary: "#262626", // --secondary 0 0% 14.9%
  muted: "#262626", // --muted 0 0% 14.9%
  mutedHalf: "rgba(38, 38, 38, 0.5)",
  mutedForeground: "#a3a3a3", // --muted-foreground 0 0% 63.9%
  border: "#262626", // --border 0 0% 14.9%
  destructive: "#dc2626", // --destructive 0 72% 51%
  success: "#4ade80", // green-400
  successSurface: "rgba(5, 46, 22, 0.3)", // green-950/30
  successBorder: "rgba(22, 101, 52, 0.5)", // green-800/50
  warning: "#fbbf24", // amber-400
  warningText: "#fbbf24", // amber-400
  warningSurface: "rgba(69, 26, 3, 0.2)", // amber-950/20
  warningBorder: "rgba(146, 64, 14, 0.4)", // amber-800/40
  activeText: "#34d399", // emerald-400
  activeSurface: "rgba(16, 185, 129, 0.1)",
  activeBorder: "rgba(16, 185, 129, 0.2)",
  pausedSurface: "rgba(245, 158, 11, 0.1)",
  pausedBorder: "rgba(245, 158, 11, 0.2)",
  completedText: "#94a3b8", // slate-400
  completedSurface: "rgba(100, 116, 139, 0.1)",
  completedBorder: "rgba(100, 116, 139, 0.2)",
};

/** Geist's weights by the names `@expo-google-fonts/geist` registers them under. A custom font in
 * React Native is one family per weight; `fontWeight` alone would fall back to the system face. */
export const font = {
  regular: "Geist_400Regular",
  medium: "Geist_500Medium",
  semibold: "Geist_600SemiBold",
  bold: "Geist_700Bold",
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;

/** `--radius: 0.5rem` — `rounded-lg` on the web. */
export const radius = { sm: 4, md: 6, lg: 8 } as const;

/** Tailwind's type scale, in points: `text-xs` … `text-xl`. */
export const text = { xs: 12, sm: 14, base: 16, lg: 18, xl: 20 } as const;

export function usePalette(): Palette {
  return useColorScheme() === "dark" ? dark : light;
}

export const palettes = { light, dark };
