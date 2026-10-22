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

/** A label over its control, with an error under it. */
export function Field({
  label,
  error,
  flex,
  children,
}: {
  label: string;
  error?: string;
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
}: {
  label: string;
  value: T;
  options: [T, string][];
  onPick: (value: T) => void;
}) {
  const palette = usePalette();
  const shown = options.find(([option]) => option === value)?.[1] ?? String(value);
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
      <Text>{shown}</Text>
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
