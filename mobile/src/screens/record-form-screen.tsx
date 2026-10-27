import type { MedicalRecord, RecordType } from "@orbit-types/medical-record";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Alert, ScrollView, View } from "react-native";
import { Choice, Field, Input, Section } from "@/components/form";
import { Button, Placeholder, Text } from "@/components/ui";
import { dayOf } from "@/features/measurements/format";
import { RECORD_TYPES } from "@/features/records/query";
import { t } from "@/lib/i18n";
import { useRecord, useSaveRecord } from "@/lib/queries";
import { space } from "@/theme";
import { recordTypeLabel } from "./records-screen";

/** A `YYYY-MM-DD` as the local midnight a date picker holds. */
function dayAsDate(day: string): Date {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year!, month! - 1, date!);
}

/** Editing a document's title, type, date and notes — the web record page's details form. */
export default function RecordFormScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { record } = useRecord(id);
  if (record.data) return <RecordForm initial={record.data} />;
  return (
    <>
      <Stack.Screen options={{ title: t("records.actions.edit"), headerLargeTitle: false }} />
      <Placeholder
        busy={record.isPending}
        message={record.isPending ? undefined : (record.error?.message ?? t("common.noResults"))}
        action={
          record.error ? (
            <Button
              variant="outline"
              label={t("common.retry")}
              onPress={() => void record.refetch()}
            />
          ) : undefined
        }
      />
    </>
  );
}

function RecordForm({ initial }: { initial: MedicalRecord }) {
  const router = useRouter();
  const save = useSaveRecord();
  const [title, setTitle] = useState(initial.title);
  const [type, setType] = useState<RecordType>(initial.record_type);
  const [date, setDate] = useState<Date | null>(
    initial.record_date ? dayAsDate(initial.record_date) : null,
  );
  const [notes, setNotes] = useState(initial.notes ?? "");

  const submit = () =>
    save.mutate(
      {
        id: initial.id,
        details: {
          title: title.trim(),
          record_type: type,
          record_date: date ? dayOf(date) : null,
          notes: notes.trim() || null,
        },
      },
      {
        onSuccess: () => router.back(),
        onError: (error) => Alert.alert(t("common.error"), error.message),
      },
    );

  return (
    <>
      <Stack.Screen
        options={{
          title: t("records.actions.edit"),
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
              disabled={!title.trim()}
              onPress={submit}
            />
          ),
        }}
      />
      <ScrollView
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xl * 2 }}
      >
        <Section title={t("records.detail.title")}>
          <Field
            label={t("records.add.recordTitle")}
            error={title.trim() ? undefined : t("common.required")}
          >
            <Input
              accessibilityLabel={t("records.add.recordTitle")}
              testID="record-title"
              value={title}
              onChangeText={setTitle}
            />
          </Field>
          <Field label={t("records.add.recordType")}>
            <Choice<RecordType>
              label={t("records.add.recordType")}
              value={type}
              options={RECORD_TYPES.map((one) => [one, recordTypeLabel(one)])}
              onPick={setType}
            />
          </Field>
          <Field label={t("records.add.recordDate")}>
            {date ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
                <DateTimePicker
                  testID="record-date"
                  value={date}
                  mode="date"
                  display="compact"
                  locale="ru"
                  onValueChange={(_event, picked) => setDate(picked)}
                />
                <Button
                  compact
                  variant="ghost"
                  label={t("common.clear")}
                  onPress={() => setDate(null)}
                />
              </View>
            ) : (
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
                <Text size="sm" tone="mutedForeground">
                  {t("records.noDate")}
                </Text>
                <Button
                  compact
                  variant="outline"
                  label={t("common.add")}
                  onPress={() => setDate(new Date())}
                />
              </View>
            )}
          </Field>
          <Field label={t("records.add.notes")}>
            <Input
              accessibilityLabel={t("records.add.notes")}
              testID="record-notes"
              placeholder={t("records.add.notesPlaceholder")}
              value={notes}
              onChangeText={setNotes}
              multiline
              style={{ minHeight: 96, textAlignVertical: "top" }}
            />
          </Field>
        </Section>
      </ScrollView>
    </>
  );
}
