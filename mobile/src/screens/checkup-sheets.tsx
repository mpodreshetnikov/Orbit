import type { CheckupCompletion, CheckupItem } from "@orbit-types/checkup";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState, type ReactNode } from "react";
import { Alert, ScrollView } from "react-native";
import { Choice, Field, Input, Section } from "@/components/form";
import { Button, Placeholder, Text } from "@/components/ui";
import { dayOf, formatDay } from "@/features/measurements/format";
import { t } from "@/lib/i18n";
import {
  useActiveRecords,
  useCheckupAction,
  useCheckups,
  useCompletions,
  usePerson,
} from "@/lib/queries";
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
  const item = checkups.data?.find((one) => one.id === id && one.status === "active");
  if (item) return children(item);
  const failed = person.error ?? checkups.error;
  const busy = !failed && (person.isPending || (checkups.isPending && checkups.isFetching));
  return (
    <>
      <Stack.Screen options={{ title, headerLargeTitle: false }} />
      {failed ? (
        <Placeholder
          message={failed.message}
          action={
            <Button
              variant="outline"
              label={t("common.retry")}
              onPress={() => void (person.error ? person.refetch() : checkups.refetch())}
            />
          }
        />
      ) : (
        <Placeholder busy={busy} message={busy ? undefined : t("common.noResults")} />
      )}
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

/**
 * The web "Отметить выполненным" dialog: the day it was done, a note, a record as evidence. With
 * `?completion=` it is the web edit-completion dialog instead, which can also delete it.
 */
export default function CompleteCheckupScreen() {
  const { completion } = useLocalSearchParams<{ completion?: string }>();
  return (
    <WithCheckup title={t("checkups.markComplete")}>
      {(item) => <CompleteForm item={item} completionId={completion} />}
    </WithCheckup>
  );
}

function CompleteForm({ item, completionId }: { item: CheckupItem; completionId?: string }) {
  const completions = useCompletions(item.id);
  const editing = completions.data?.find((one) => one.id === completionId);
  if (!completionId) return <CompletionForm item={item} />;
  if (editing) return <CompletionForm item={item} editing={editing} />;
  return (
    <Placeholder
      busy={completions.isPending}
      message={completions.isPending ? undefined : t("common.noResults")}
    />
  );
}

function CompletionForm({ item, editing }: { item: CheckupItem; editing?: CheckupCompletion }) {
  const router = useRouter();
  const records = useActiveRecords(item.person_id);
  const action = useCheckupAction();
  const [doneAt, setDoneAt] = useState(() =>
    editing ? new Date(`${editing.done_at}T12:00:00`) : new Date(),
  );
  const [note, setNote] = useState(editing?.note ?? "");
  const [recordId, setRecordId] = useState(editing?.evidence_record_id ?? "none");
  const done = {
    onSuccess: () => router.back(),
    onError: (error: Error) => Alert.alert(t("common.error"), error.message),
  };

  const completion = {
    done_at: dayOf(doneAt),
    note,
    evidence_record_id: recordId === "none" ? null : recordId,
  };
  const save = () =>
    action.mutate(editing ? { completionId: editing.id, completion } : { item, completion }, done);
  const remove = (id: string) =>
    Alert.alert(t("common.delete"), t("checkups.deleteCompletionConfirm"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.delete"),
        style: "destructive",
        onPress: () => action.mutate({ completionId: id, completion: null }, done),
      },
    ]);
  const title = editing ? t("common.edit") : t("checkups.markComplete");

  return (
    <>
      <SheetHeader title={title} busy={action.isPending} onSave={save} />
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
        {editing ? (
          <Button variant="outline" label={t("common.delete")} onPress={() => remove(editing.id)} />
        ) : null}
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
