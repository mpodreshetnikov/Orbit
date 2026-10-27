import { ChevronsUpDown } from "lucide-react-native";
import { useEffect, useState, type ReactNode } from "react";
import { ActionSheetIOS, Pressable, TextInput, View, type TextInputProps } from "react-native";
import { Card, Icon, Text } from "@/components/ui";
import { parseAmount } from "@/features/medications/form";
import { t } from "@/lib/i18n";
import { font, radius, space, text, usePalette } from "@/theme";

/** A titled group of fields: one of the web form's sections. */
export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ gap: space.sm }}>
      <Text size="xs" weight="medium" tone="mutedForeground" style={{ marginLeft: space.xs }}>
        {title.toUpperCase()}
      </Text>
      <Card style={{ padding: space.lg, gap: space.lg }}>{children}</Card>
    </View>
  );
}

/** A label over its control, with an error or a hint under it. */
export function Field({
  label,
  error,
  hint,
  flex,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  /** Share a row with the fields beside it. */
  flex?: boolean;
  children: ReactNode;
}) {
  return (
    <View style={{ gap: space.xs, flex: flex ? 1 : undefined }}>
      <Text size="sm" weight="medium">
        {label}
      </Text>
      {children}
      {error ? (
        <Text size="xs" tone="destructive">
          {error}
        </Text>
      ) : hint ? (
        <Text size="xs" tone="mutedForeground">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

/** The web app's `Input`: a bordered field in the body face. */
export function Input({ style, ...props }: TextInputProps) {
  const palette = usePalette();
  return (
    <TextInput
      placeholderTextColor={palette.mutedForeground}
      {...props}
      style={[
        {
          minHeight: 40,
          paddingHorizontal: space.md,
          paddingVertical: space.sm,
          borderWidth: 1,
          borderColor: palette.border,
          borderRadius: radius.md,
          color: palette.foreground,
          fontFamily: font.regular,
          fontSize: text.base,
        },
        style,
      ]}
    />
  );
}

/**
 * A number field that lets its text be half-typed: "", "2," and "0." stay as typed, and the value
 * changes only once the text reads as a number (or clears, for an optional one).
 */
export function NumberInput({
  value,
  onValue,
  integer,
  ...props
}: Omit<TextInputProps, "value" | "onChangeText"> & {
  value: number | null;
  onValue: (value: number | null) => void;
  integer?: boolean;
}) {
  const [typed, setTyped] = useState(value == null ? "" : String(value));
  useEffect(() => {
    // Follow a value set from outside (quick-set, a change of mode) without fighting the typing.
    setTyped((current) =>
      parseAmount(current) === value ? current : value == null ? "" : String(value),
    );
  }, [value]);
  return (
    <Input
      keyboardType={integer ? "number-pad" : "decimal-pad"}
      {...props}
      value={typed}
      onChangeText={(text) => {
        setTyped(text);
        const amount = parseAmount(text);
        if (amount != null || !text.trim()) onValue(amount);
      }}
    />
  );
}

/**
 * A select as a row that opens the system's sheet of `options`, each a value and its label; the row
 * shows the label of `value`.
 */
export function Choice<T>({
  label,
  value,
  options,
  onPick,
  placeholder,
}: {
  label: string;
  value: T;
  options: [T, string][];
  onPick: (value: T) => void;
  /** Shown while `value` is none of the options. */
  placeholder?: string;
}) {
  const palette = usePalette();
  const shown = options.find(([option]) => option === value)?.[1] ?? placeholder ?? String(value);
  const open = () => {
    const labels = [...options.map(([, one]) => one), t("common.cancel")];
    ActionSheetIOS.showActionSheetWithOptions(
      { title: label, options: labels, cancelButtonIndex: labels.length - 1 },
      (index) => {
        const option = options[index];
        if (option) onPick(option[0]);
      },
    );
  };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${shown}`}
      onPress={open}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        minHeight: 40,
        paddingHorizontal: space.md,
        borderWidth: 1,
        borderColor: palette.border,
        borderRadius: radius.md,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Text tone={shown === placeholder ? "mutedForeground" : "foreground"} style={{ flex: 1 }}>
        {shown}
      </Text>
      <Icon icon={ChevronsUpDown} size={14} />
    </Pressable>
  );
}

/** A pill that is on or off: a weekday, a count of intakes, a course to add to. */
export function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={{
        minWidth: 40,
        alignItems: "center",
        paddingHorizontal: space.md,
        paddingVertical: 6,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: selected ? palette.primary : palette.border,
        backgroundColor: selected ? palette.primary : "transparent",
      }}
    >
      <Text size="sm" weight="medium" tone={selected ? "primaryForeground" : "foreground"}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * The system's segmented switch, drawn here: a muted track with the chosen segment raised on it.
 * Each segment is a tab for VoiceOver, with its selection stated.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: [T, string][];
  value: T;
  onChange: (value: T) => void;
}) {
  const palette = usePalette();
  return (
    <View
      accessibilityRole="tablist"
      style={{
        flexDirection: "row",
        padding: 2,
        borderRadius: radius.md,
        backgroundColor: palette.muted,
      }}
    >
      {options.map(([option, label]) => {
        const selected = option === value;
        return (
          <Pressable
            key={option}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(option)}
            style={{
              flex: 1,
              minHeight: 30,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: radius.md - 2,
              backgroundColor: selected ? palette.background : "transparent",
              shadowColor: "#000",
              shadowOpacity: selected ? 0.12 : 0,
              shadowRadius: 2,
              shadowOffset: { width: 0, height: 1 },
            }}
          >
            <Text size="sm" weight={selected ? "semibold" : "medium"}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
