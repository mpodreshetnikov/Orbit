import DateTimePicker from "@react-native-community/datetimepicker";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ScrollView } from "react-native";
import { Choice, Field, Input, NumberInput, Section } from "@/components/form";
import { Button, Placeholder, Text } from "@/components/ui";
import { categoryLabel, formatDay, formatValue } from "@/features/measurements/format";
import { t } from "@/lib/i18n";
import {
  useMeasurementCatalog,
  useMeasurements,
  usePerson,
  useSaveMeasurement,
} from "@/lib/queries";
import { space } from "@/theme";

/**
 * Record a measurement, or correct one — the web app's add and edit dialogs in one sheet.
 *
 * Opened from a measurement's page the type is already chosen; opened from the list it is picked
 * from the catalogue in the system's sheet. As on the web, the last value recorded for the type is
 * shown under the field as a reference, and the moment defaults to now.
 */
export default function MeasurementFormScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ code?: string; entry?: string }>();
  const person = usePerson();
  const personId = person.data?.id;
  const catalog = useMeasurementCatalog();
  const measurements = useMeasurements(personId);
  const save = useSaveMeasurement();

  const summary = measurements.data?.find((one) => one.code === params.code);
  const editing = params.entry
    ? summary?.history.find((point) => point.id === params.entry)
    : undefined;

  const [catalogId, setCatalogId] = useState<string | null>(null);
  const [value, setValue] = useState<number | null>(null);
  const [measuredAt, setMeasuredAt] = useState(() => new Date());
  const [notes, setNotes] = useState("");
  const [missing, setMissing] = useState(false);

  // Fill from the entry being edited, or the type the page was opened for, once they have loaded.
  useEffect(() => {
    if (editing) {
      setValue(editing.value);
      setMeasuredAt(new Date(editing.measured_at));
      setNotes(editing.notes ?? "");
    }
  }, [editing]);
  useEffect(() => {
    const preset = catalog.data?.find((item) => item.code === params.code);
    if (preset) setCatalogId((current) => current ?? preset.id);
  }, [catalog.data, params.code]);

  const type = catalog.data?.find((item) => item.id === catalogId);
  const last = measurements.data?.find((one) => one.code === type?.code);

  const submit = () => {
    if (!personId || !catalogId || value == null) {
      setMissing(true);
      return;
    }
    const entry = {
      value,
      measured_at: measuredAt.toISOString(),
      notes: notes.trim() || null,
    };
    save.mutate(editing ? { id: editing.id, entry } : { personId, catalogId, entry }, {
      onSuccess: () => router.back(),
    });
  };

  const header = (
    <Stack.Screen
      options={{
        title: t(params.entry ? "measurements.editMeasurement" : "measurements.addMeasurement"),
        headerLargeTitle: false,
        headerLeft: () => (
          <Button
            compact
            variant="ghost"
            label={t("common.cancel")}
            onPress={() => router.back()}
          />
        ),
        headerRight: () => (
          <Button
            compact
            variant="ghost"
            label={t("common.save")}
            busy={save.isPending}
            onPress={submit}
          />
        ),
      }}
    />
  );

  if (!catalog.data || (params.entry && !editing)) {
    return (
      <>
        {header}
        {catalog.isPending || measurements.isPending ? (
          <Placeholder busy />
        ) : (
          <Placeholder message={catalog.error?.message ?? t("measurements.noData")} />
        )}
      </>
    );
  }

  return (
    <>
      {header}
      <ScrollView
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xl * 2 }}
      >
        <Section
          title={t(params.entry ? "measurements.editDescription" : "measurements.addDescription")}
        >
          <Field
            label={t("measurements.selectType")}
            error={missing && !catalogId ? t("measurements.selectTypePlaceholder") : undefined}
          >
            {params.entry ? (
              <Text>{type?.name_ru}</Text>
            ) : (
              <Choice
                label={t("measurements.selectType")}
                value={catalogId}
                placeholder={t("measurements.selectTypePlaceholder")}
                options={catalog.data.map((item) => [
                  item.id,
                  `${item.name_ru}${item.unit_ru ? `, ${item.unit_ru}` : ""} · ${categoryLabel(item.category)}`,
                ])}
                onPick={setCatalogId}
              />
            )}
          </Field>
          <Field
            label={
              type?.unit_ru
                ? `${t("measurements.value")}, ${type.unit_ru}`
                : t("measurements.value")
            }
            error={missing && value == null ? t("measurements.value") : undefined}
            hint={
              params.entry || !type
                ? undefined
                : last
                  ? `${t("measurements.lastRecorded")}: ${formatValue(last.latest_value, 2)} ${type.unit_ru} · ${formatDay(last.latest_date)}`
                  : t("measurements.noPreviousValue")
            }
          >
            <NumberInput
              accessibilityLabel={t("measurements.value")}
              value={value}
              onValue={setValue}
              autoFocus={!params.entry}
            />
          </Field>
          <Field label={t("measurements.measuredAt")}>
            <DateTimePicker
              testID="measured-at"
              value={measuredAt}
              mode="datetime"
              display="compact"
              locale="ru"
              style={{ alignSelf: "flex-start" }}
              onValueChange={(_event, date) => setMeasuredAt(date)}
            />
          </Field>
          <Field label={t("measurements.notes")}>
            <Input
              accessibilityLabel={t("measurements.notes")}
              placeholder={t("measurements.notesPlaceholder")}
              value={notes}
              onChangeText={setNotes}
              multiline
              style={{ minHeight: 80, textAlignVertical: "top" }}
            />
          </Field>
        </Section>
      </ScrollView>
    </>
  );
}
