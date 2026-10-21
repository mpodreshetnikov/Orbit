import type { LucideIcon } from "lucide-react-native";
import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  Text as NativeText,
  View,
  type PressableProps,
  type StyleProp,
  type TextProps,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { font, radius, space, text, usePalette, type Palette } from "@/theme";

type Weight = keyof typeof font;
type Size = keyof typeof text;

/**
 * Text in the web app's face and scale. `tone` picks a palette colour, so a screen never carries a
 * hex value of its own.
 */
export function Text({
  size = "base",
  weight = "regular",
  tone = "foreground",
  tabular,
  style,
  ...props
}: TextProps & {
  size?: Size;
  weight?: Weight;
  tone?: keyof Palette;
  /** `tabular-nums`, for times that should not shift as their digits change. */
  tabular?: boolean;
}) {
  const palette = usePalette();
  return (
    <NativeText
      {...props}
      style={[
        {
          fontFamily: font[weight],
          fontSize: text[size],
          lineHeight: Math.round(text[size] * 1.4),
          color: palette[tone] as string,
        },
        tabular && { fontVariant: ["tabular-nums"] },
        style,
      ]}
    />
  );
}

/** A lucide icon at the web app's sizes: `h-4 w-4` is 16, `h-3.5` is 14. */
export function Icon({
  icon: Glyph,
  size = 16,
  tone = "mutedForeground",
}: {
  icon: LucideIcon;
  size?: number;
  tone?: keyof Palette;
}) {
  const palette = usePalette();
  return <Glyph size={size} color={palette[tone] as string} strokeWidth={2} />;
}

/** `Card`: a bordered, rounded surface. */
export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const palette = usePalette();
  return (
    <View
      style={[
        {
          backgroundColor: palette.card,
          borderColor: palette.border,
          borderWidth: 1,
          borderRadius: radius.lg,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

/** `Badge variant="outline"`, tinted by the caller. */
export function Badge({
  label,
  icon,
  textTone = "foreground",
  surface,
  border,
}: {
  label: string;
  icon?: LucideIcon;
  textTone?: keyof Palette;
  surface?: string;
  border?: string;
}) {
  const palette = usePalette();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: space.xs,
        alignSelf: "flex-start",
        borderRadius: 999,
        borderWidth: 1,
        borderColor: border ?? palette.border,
        backgroundColor: surface ?? "transparent",
        paddingHorizontal: 10,
        paddingVertical: 2,
      }}
    >
      {icon ? <Icon icon={icon} size={12} tone={textTone} /> : null}
      <Text size="xs" weight="semibold" tone={textTone}>
        {label}
      </Text>
    </View>
  );
}

type ButtonVariant = "primary" | "secondary" | "outline" | "ghost";

/**
 * The web app's `Button`, with its press-in: on a touch screen it scales to 0.98, as `.tap-target`
 * does in `globals.css`.
 */
export function Button({
  label,
  icon,
  variant = "primary",
  compact,
  busy,
  disabled,
  style,
  ...props
}: Omit<PressableProps, "style"> & {
  label?: string;
  icon?: LucideIcon;
  variant?: ButtonVariant;
  /** `size="sm"` with `h-7`: the inline buttons on a dose row. */
  compact?: boolean;
  busy?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const palette = usePalette();
  const fill: Record<ButtonVariant, string> = {
    primary: palette.primary,
    secondary: palette.secondary,
    outline: palette.background,
    ghost: "transparent",
  };
  const tone: keyof Palette = variant === "primary" ? "primaryForeground" : "foreground";
  const labelStyle: TextStyle = { textAlign: "center" };
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || busy}
      hitSlop={compact ? space.sm : undefined}
      {...props}
      style={({ pressed }) => [
        {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: space.xs,
          minHeight: compact ? 28 : 40,
          minWidth: compact ? 28 : undefined,
          paddingHorizontal: label ? (compact ? space.sm : space.lg) : 0,
          borderRadius: radius.md,
          backgroundColor: fill[variant],
          borderWidth: variant === "outline" ? 1 : 0,
          borderColor: palette.border,
          opacity: disabled ? 0.5 : 1,
          transform: [{ scale: pressed ? 0.98 : 1 }],
        },
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={palette[tone] as string} />
      ) : icon ? (
        <Icon icon={icon} size={compact ? 14 : 16} tone={tone} />
      ) : null}
      {label ? (
        <Text size={compact ? "xs" : "sm"} weight="medium" tone={tone} style={labelStyle}>
          {label}
        </Text>
      ) : null}
    </Pressable>
  );
}

/** A centred message with an optional action: the empty, loading and error states. */
export function Placeholder({
  message,
  busy,
  action,
}: {
  message?: string;
  busy?: boolean;
  action?: ReactNode;
}) {
  const palette = usePalette();
  return (
    <View
      style={{
        flexGrow: 1,
        alignItems: "center",
        justifyContent: "center",
        gap: space.lg,
        padding: space.xl,
      }}
    >
      {busy ? <ActivityIndicator color={palette.mutedForeground} /> : null}
      {message ? (
        <Text size="sm" tone="mutedForeground" style={{ textAlign: "center" }}>
          {message}
        </Text>
      ) : null}
      {action}
    </View>
  );
}
