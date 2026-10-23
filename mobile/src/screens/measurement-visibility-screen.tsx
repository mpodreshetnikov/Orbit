import { Stack } from "expo-router";
import { Pressable, ScrollView, Switch, View } from "react-native";
import { Card, Placeholder, Text } from "@/components/ui";
import { byCategory, categoryLabel } from "@/features/measurements/format";
import { t } from "@/lib/i18n";
import { useHiddenMeasurements, useMeasurements, usePerson } from "@/lib/queries";
import { space } from "@/theme";

/**
 * "Выбрать измерения" — the web visibility dialog: a switch per measurement the person has, off to
 * keep it out of the list. Nothing is deleted, and a hidden type can still be recorded.
 */
export default function MeasurementVisibilityScreen() {
  const person = usePerson();
  const measurements = useMeasurements(person.data?.id);
  const hidden = useHiddenMeasurements(person.data?.id);

  return (
    <>
      <Stack.Screen
        options={{ title: t("measurements.visibilityTitle"), headerLargeTitle: false }}
      />
      {!measurements.data || !hidden.ready ? (
        <Placeholder
          busy={measurements.isPending || hidden.pending}
          message={(measurements.error ?? hidden.error)?.message}
        />
      ) : (
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xl * 2 }}
        >
          <Text size="sm" tone="mutedForeground">
            {t("measurements.visibilityDescription")}
          </Text>
          {byCategory(measurements.data).map((section) => (
            <View key={section.category} style={{ gap: space.sm }}>
              <Text
                size="xs"
                weight="medium"
                tone="mutedForeground"
                style={{ marginLeft: space.xs }}
              >
                {categoryLabel(section.category).toUpperCase()}
              </Text>
              <Card style={{ paddingHorizontal: space.lg, paddingVertical: space.xs }}>
                {section.data.map((item) => (
                  <Pressable
                    key={item.code}
                    onPress={() => hidden.toggle(item.code)}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                      paddingVertical: space.sm,
                    }}
                  >
                    <Text style={{ flex: 1 }}>{item.name_ru}</Text>
                    <Switch
                      accessibilityLabel={item.name_ru}
                      value={!hidden.codes.has(item.code)}
                      onValueChange={() => hidden.toggle(item.code)}
                    />
                  </Pressable>
                ))}
              </Card>
            </View>
          ))}
        </ScrollView>
      )}
    </>
  );
}
