import type { ConditionStatus } from "@orbit-types/condition";
import { CONDITION_SECTION_ORDER } from "@orbit-types/condition-summary";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Alert, ScrollView } from "react-native";
import { Choice, Field, Input, Section } from "@/components/form";
import { Button, Placeholder } from "@/components/ui";
import type { ConditionDetail } from "@/features/conditions/query";
import { formatDay } from "@/features/measurements/format";
import { t } from "@/lib/i18n";
import { useActiveRecords, useAddConditionHistory, useCondition } from "@/lib/queries";
import { space } from "@/theme";

/** The local day of `date` as a record stores it: `YYYY-MM-DD`. */
export function dayOf(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * The web "Добавить в историю" dialog: a status as of a day, with a note, linked to one of the
 * person's records or written into a manual entry of its own.
 */
export default function ConditionHistoryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const condition = useCondition(id);
  if (condition.data) return <HistoryForm condition={condition.data} />;
  return (
    <>
      <Stack.Screen options={{ title: t("conditions.addToHistory"), headerLargeTitle: false }} />
      <Placeholder
        busy={condition.isPending}
        message={
          condition.isPending
            ? undefined
            : (condition.error?.message ?? t("conditions.conditionNotFound"))
        }
        action={
          condition.error ? (
            <Button
              variant="outline"
              label={t("common.retry")}
              onPress={() => void condition.refetch()}
            />
          ) : undefined
        }
      />
    </>
  );
}

function HistoryForm({ condition }: { condition: ConditionDetail }) {
  const router = useRouter();
  const records = useActiveRecords(condition.person_id);
  // A record mentions a condition once: the ones that already do are not offered again.
  const linked = new Set(condition.history.map((mention) => mention.record_id));
  const choices = (records.data ?? []).filter((one) => !linked.has(one.id));
  const add = useAddConditionHistory();
  const [status, setStatus] = useState<ConditionStatus>("active");
  const [date, setDate] = useState(() => new Date());
  const [note, setNote] = useState("");
  const [recordId, setRecordId] = useState("none");

  const submit = () =>
    add.mutate(
      {
        conditionId: condition.id,
        conditionName: condition.name,
        personId: condition.person_id,
        status,
        date: dayOf(date),
        note,
        record: choices.find((one) => one.id === recordId) ?? null,
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
          title: t("conditions.addToHistory"),
          headerLargeTitle: false,
          headerLeft: () => (
            <Button compact variant="ghost" label={t("common.cancel")} onPress={router.back} />
          ),
          headerRight: () => (
            <Button
              compact
              variant="ghost"
              label={t("common.save")}
              busy={add.isPending}
              onPress={submit}
            />
          ),
        }}
      />
      <ScrollView
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xl * 2 }}
      >
        <Section title={t("conditions.addToHistoryDescription")}>
          <Field label={t("conditions.statusInRecord")}>
            <Choice<ConditionStatus>
              label={t("conditions.statusInRecord")}
              value={status}
              options={CONDITION_SECTION_ORDER.map((one) => [one, t(`conditions.status.${one}`)])}
              onPick={setStatus}
            />
          </Field>
          <Field label={t("conditions.historyDate")}>
            <DateTimePicker
              testID="history-date"
              value={date}
              mode="date"
              display="compact"
              locale="ru"
              style={{ alignSelf: "flex-start" }}
              onValueChange={(_event, picked) => setDate(picked)}
            />
          </Field>
          <Field label={t("conditions.historyNote")}>
            <Input
              accessibilityLabel={t("conditions.historyNote")}
              testID="history-note"
              placeholder={t("conditions.historyNotePlaceholder")}
              value={note}
              onChangeText={setNote}
              multiline
              style={{ minHeight: 80, textAlignVertical: "top" }}
            />
          </Field>
          <Field label={t("conditions.linkToRecord")} hint={t("conditions.linkToRecordHint")}>
            <Choice<string>
              label={t("conditions.linkToRecord")}
              value={recordId}
              options={[
                ["none", t("conditions.noLinkToRecord")],
                ...choices.map((one): [string, string] => [
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
