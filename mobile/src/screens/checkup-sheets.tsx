import type { CheckupItem } from "@orbit-types/checkup";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState, type ReactNode } from "react";
import { Alert, ScrollView } from "react-native";
import { Choice, Field, Input, Section } from "@/components/form";
import { Button, Placeholder, Text } from "@/components/ui";
import { dayOf, formatDay } from "@/features/measurements/format";
import { t } from "@/lib/i18n";
import { useActiveRecords, useCheckupAction, useCheckups, usePerson } from "@/lib/queries";
import { space } from "@/theme";

/**
 * The checkup a sheet is about, by `?id=`, from the list already loaded; the sheet itself once it
 * is there.
 */
function WithCheckup({
  title,
  children,
}: {
  title: string;
  children: (item: CheckupItem) => ReactNode;
}) {
  const { id } = useLocalSearchParams<{ id: string }>();
  const person = usePerson();
  const checkups = useCheckups(person.data?.id);
  const item = checkups.data?.find((one) => one.id === id);
  if (item) return children(item);
  const busy = person.isPending || checkups.isPending;
  return (
    <>
      <Stack.Screen options={{ title, headerLargeTitle: false }} />
      <Placeholder busy={busy} message={busy ? undefined : t("common.noResults")} />
    </>
  );
}

/** The sheet's bar: cancel on the left, save on the right. */
function SheetHeader({
  title,
  busy,
  onSave,
}: {
  title: string;
  busy: boolean;
  onSave: () => void;
}) {
  const router = useRouter();
  return (
    <Stack.Screen
      options={{
        title,
        headerLargeTitle: false,
        headerLeft: () => (
          <Button compact variant="ghost" label={t("common.cancel")} onPress={router.back} />
        ),
        headerRight: () => (
          <Button compact variant="ghost" label={t("common.save")} busy={busy} onPress={onSave} />
        ),
      }}
    />
  );
}

/** The web "Отметить выполненным" dialog: the day it was done, a note, a record as evidence. */
export default function CompleteCheckupScreen() {
  return (
    <WithCheckup title={t("checkups.markComplete")}>
      {(item) => <CompleteForm item={item} />}
    </WithCheckup>
  );
}

function CompleteForm({ item }: { item: CheckupItem }) {
  const router = useRouter();
  const records = useActiveRecords(item.person_id);
  const action = useCheckupAction();
  const [doneAt, setDoneAt] = useState(() => new Date());
  const [note, setNote] = useState("");
  const [recordId, setRecordId] = useState("none");

  const save = () =>
    action.mutate(
      {
        item,
        completion: {
          done_at: dayOf(doneAt),
          note,
          evidence_record_id: recordId === "none" ? null : recordId,
        },
      },
      {
        onSuccess: () => router.back(),
        onError: (error) => Alert.alert(t("common.error"), error.message),
      },
    );

  return (
    <>
      <SheetHeader title={t("checkups.markComplete")} busy={action.isPending} onSave={save} />
      <ScrollView
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ padding: space.lg, gap: space.lg }}
      >
        <Section title={item.title}>
          <Field label={t("checkups.completionDate")}>
            <DateTimePicker
              testID="done-at"
              value={doneAt}
              mode="date"
              display="compact"
              locale="ru"
              style={{ alignSelf: "flex-start" }}
              onValueChange={(_event, date) => setDoneAt(date)}
            />
          </Field>
          <Field label={t("checkups.completionNote")}>
            <Input
              accessibilityLabel={t("checkups.completionNote")}
              testID="completion-note"
              placeholder={t("checkups.completionNotePlaceholder")}
              value={note}
              onChangeText={setNote}
              multiline
              style={{ minHeight: 64, textAlignVertical: "top" }}
            />
          </Field>
          <Field label={t("checkups.attachRecord")} hint={t("checkups.attachRecordHint")}>
            <Choice<string>
              label={t("checkups.attachRecord")}
              value={recordId}
              options={[
                ["none", t("checkups.noRecord")],
                ...(records.data ?? []).map((one): [string, string] => [
                  one.id,
                  one.record_date ? `${one.title} · ${formatDay(one.record_date)}` : one.title,
                ]),
              ]}
              onPick={setRecordId}
            />
          </Field>
        </Section>
      </ScrollView>
    </>
  );
}

/** The web "Запланировать на дату" dialog, for one checkup: a day to do it, or none. */
export function PlanCheckupScreen() {
  return (
    <WithCheckup title={t("checkups.planFor")}>{(item) => <PlanForm item={item} />}</WithCheckup>
  );
}

function PlanForm({ item }: { item: CheckupItem }) {
  const router = useRouter();
  const action = useCheckupAction();
  const [day, setDay] = useState(() =>
    item.planned_on ? new Date(`${item.planned_on}T12:00:00`) : new Date(),
  );

  const plan = (plannedOn: string | null) =>
    action.mutate(
      { item, plannedOn },
      {
        onSuccess: () => router.back(),
        onError: (error) => Alert.alert(t("common.error"), error.message),
      },
    );

  return (
    <>
      <SheetHeader
        title={t("checkups.planFor")}
        busy={action.isPending}
        onSave={() => plan(dayOf(day))}
      />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
        <Section title={item.title}>
          <Text size="sm" tone="mutedForeground">
            {t("checkups.planForHint")}
          </Text>
          <Field label={t("checkups.plannedOn")}>
            <DateTimePicker
              testID="planned-on"
              value={day}
              mode="date"
              display="compact"
              locale="ru"
              style={{ alignSelf: "flex-start" }}
              onValueChange={(_event, date) => setDay(date)}
            />
          </Field>
          {item.planned_on ? (
            <Button
              variant="outline"
              label={t("checkups.removePlannedDate")}
              onPress={() => plan(null)}
            />
          ) : null}
        </Section>
      </ScrollView>
    </>
  );
}
