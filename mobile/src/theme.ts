/**
 * The few values every screen shares.
 *
 * Deliberately not a design system: a token file that grows ahead of the screens using it becomes a
 * second source of truth about how the app looks. Add to this when a second screen needs the value.
 */
export const theme = {
  color: {
    background: "#ffffff",
    surface: "#f4f4f5",
    text: "#18181b",
    textMuted: "#71717a",
    accent: "#2563eb",
    danger: "#b91c1c",
    done: "#15803d",
  },
  space: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
  },
  radius: 12,
} as const;
