import type { CheckupCategory, CheckupItem, CheckupNextDueFrom } from "@orbit-types/checkup";
import { CHECKUP_CATEGORIES } from "@orbit-types/checkup";
import {
  anchorPresets,
  checkupColumns,
  checkupFormProblem,
  effectiveInterval,
  FREQUENCY_PRESETS,
  initialCheckupForm,
  toggleConditionLink,
  type AnchorPreset,
  type CheckupFormValues,
  type FrequencyPreset,
  type IntervalUnit,
} from "@orbit-types/checkup-form";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { X } from "lucide-react-native";
import { useState } from "react";
import { Alert, Pressable, ScrollView, View } from "react-native";
import { Chip, Choice, Field, Input, NumberInput, Section } from "@/components/form";
import { Button, Icon, Text } from "@/components/ui";
import { categoryLabel } from "@/features/checkups/query";
import { dayOf } from "@/features/measurements/format";
import { noonOf } from "@/features/medications/form";
import { t } from "@/lib/i18n";
import { useCheckupAction, useCheckups, useConditions, usePerson } from "@/lib/queries";
import { CheckupMissing } from "@/screens/checkup-sheets";
import { space } from "@/theme";

const FREQUENCY_LABEL: Record<FrequencyPreset, string> = {
  "1_month": "checkups.interval1Month",
  "3_month": "checkups.interval3Months",
  "6_month": "checkups.interval6Months",
  "1_year": "checkups.interval1Year",
  custom: "checkups.customFrequency",
};

const UNIT_LABEL: Record<IntervalUnit, string> = {
  week: "checkups.weeks",
  month: "checkups.months",
  year: "checkups.years",
};

const ANCHOR_LABEL: Record<AnchorPreset, string> = {
  next_period: "checkups.anchorNextPeriod",
  first_of_year: "checkups.anchorFirstOfYear",
  first_of_month: "checkups.anchorFirstOfMonth",
  winter: "checkups.anchorWinter",
  spring: "checkups.anchorSpring",
  summer: "checkups.anchorSummer",
  autumn: "checkups.anchorAutumn",
  custom: "checkups.anchorCustom",
};

/** A checkup, new or being edited — the web checkup form, by `?id=` when editing. */
export default function CheckupFormScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const person = usePerson();
  const checkups = useCheckups(person.data?.id);
  const item = id ? checkups.data?.find((one) => one.id === id) : undefined;
  if (person.data && (!id || item)) return <CheckupForm personId={person.data.id} item={item} />;
  return (
    <>
      <Stack.Screen options={{ title: t("checkups.edit"), headerLargeTitle: false }} />
      <CheckupMissing person={person} checkups={checkups} />
    </>
  );
}

function CheckupForm({ personId, item }: { personId: string; item?: CheckupItem }) {
  const router = useRouter();
  const action = useCheckupAction();
  const conditions = useConditions(personId);
  const [form, setForm] = useState<CheckupFormValues>(() => initialCheckupForm(item));
  const [problem, setProblem] = useState<string | null>(null);
  const set = (changes: Partial<CheckupFormValues>) =>
    setForm((current) => {
      const next = { ...current, ...changes };
      // A start the new interval does not offer falls back to "from today", as on the web.
      const { every, unit } = effectiveInterval(next.preset, next.customEvery, next.customUnit);
      return anchorPresets(every, unit).includes(next.anchorPreset)
        ? next
        : { ...next, anchorPreset: "next_period" };
    });
  const { every, unit } = effectiveInterval(form.preset, form.customEvery, form.customUnit);

  const submit = () => {
    const found = checkupFormProblem(form);
    setProblem(found);
    if (found) return;
    action.mutate(
      { personId, id: item?.id, columns: checkupColumns(form, new Date()) },
      {
        onSuccess: () => router.back(),
        onError: (error) => Alert.alert(t("common.error"), error.message),
      },
    );
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: t(item ? "checkups.edit" : "checkups.add"),
          headerLargeTitle: false,
          headerLeft: () => (
            <Button compact variant="ghost" label={t("common.cancel")} onPress={router.back} />
          ),
          headerRight: () => (
            <Button
              compact
              variant="ghost"
              label={t("common.save")}
              busy={action.isPending}
              onPress={submit}
            />
          ),
        }}
      />
      <ScrollView
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xl * 2 }}
      >
        <Section title={t("checkups.navTitle")}>
          <Field
            label={t("checkups.itemTitle")}
            error={problem === "title" ? t("checkups.validationTitleRequired") : undefined}
          >
            <Input
              accessibilityLabel={t("checkups.itemTitle")}
              testID="checkup-title"
              placeholder={t("checkups.titlePlaceholder")}
              value={form.title}
              onChangeText={(title) => set({ title })}
            />
          </Field>
          <Field label={t("checkups.category")}>
            <Choice<CheckupCategory>
              label={t("checkups.category")}
              value={form.category}
              options={CHECKUP_CATEGORIES.map((one) => [one, categoryLabel(one)])}
              onPick={(category) => set({ category })}
            />
          </Field>
        </Section>

        <Section title={t("checkups.schedule")}>
          <View style={{ flexDirection: "row", gap: space.sm }}>
            <Chip
              label={t("checkups.recurring")}
              selected={form.scheduleType === "interval"}
              onPress={() => set({ scheduleType: "interval" })}
            />
            <Chip
              label={t("checkups.oneOff")}
              selected={form.scheduleType === "one_off"}
              onPress={() =>
                set({ scheduleType: "one_off", oneOffDueAt: form.oneOffDueAt || dayOf(new Date()) })
              }
            />
          </View>
          {form.scheduleType === "one_off" ? (
            <Field label={t("checkups.dueDate")}>
              <DateTimePicker
                testID="due-at"
                value={noonOf(form.oneOffDueAt)}
                mode="date"
                display="compact"
                locale="ru"
                style={{ alignSelf: "flex-start" }}
                onValueChange={(_event, date) => set({ oneOffDueAt: dayOf(date) })}
              />
            </Field>
          ) : (
            <>
              <Field label={t("checkups.frequency")}>
                <Choice<FrequencyPreset>
                  label={t("checkups.frequency")}
                  value={form.preset}
                  options={FREQUENCY_PRESETS.map((one) => [one, t(FREQUENCY_LABEL[one])])}
                  onPick={(preset) => set({ preset })}
                />
              </Field>
              {form.preset === "custom" ? (
                <View style={{ flexDirection: "row", gap: space.md }}>
                  <Field label={t("checkups.every")} flex>
                    <NumberInput
                      accessibilityLabel={t("checkups.every")}
                      integer
                      value={form.customEvery}
                      onValue={(value) => set({ customEvery: Math.max(1, value ?? 1) })}
                    />
                  </Field>
                  <Field label=" " flex>
                    <Choice<IntervalUnit>
                      label={t("checkups.every")}
                      value={form.customUnit}
                      options={(["week", "month", "year"] as const).map((one) => [
                        one,
                        t(UNIT_LABEL[one]),
                      ])}
                      onPick={(customUnit) => set({ customUnit })}
                    />
                  </Field>
                </View>
              ) : null}
              <Field label={t("checkups.firstDueDate")}>
                <Choice<AnchorPreset>
                  label={t("checkups.firstDueDate")}
                  value={form.anchorPreset}
                  options={anchorPresets(every, unit).map((one) => [one, t(ANCHOR_LABEL[one])])}
                  onPick={(anchorPreset) =>
                    set({
                      anchorPreset,
                      customAnchorDate: form.customAnchorDate || dayOf(new Date()),
                    })
                  }
                />
              </Field>
              {form.anchorPreset === "custom" ? (
                <DateTimePicker
                  testID="anchor-date"
                  value={noonOf(form.customAnchorDate)}
                  mode="date"
                  display="compact"
                  locale="ru"
                  style={{ alignSelf: "flex-start" }}
                  onValueChange={(_event, date) => set({ customAnchorDate: dayOf(date) })}
                />
              ) : null}
              <Field label={t("checkups.nextDueFrom")} hint={t("checkups.nextDueFromHint")}>
                <Choice<CheckupNextDueFrom>
                  label={t("checkups.nextDueFrom")}
                  value={form.nextDueFrom}
                  options={[
                    ["completion", t("checkups.nextDueFromCompletion")],
                    ["target", t("checkups.nextDueFromTarget")],
                  ]}
                  onPick={(nextDueFrom) => set({ nextDueFrom })}
                />
              </Field>
            </>
          )}
        </Section>

        <Section title={t("checkups.reminderDaysBeforeLabel")}>
          <Text size="xs" tone="mutedForeground">
            {t("checkups.reminderDaysBeforeHint")}
          </Text>
          {form.reminderDaysBefore.map((days, index) => (
            <View key={index} style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
              <NumberInput
                accessibilityLabel={t("checkups.reminderDaysBeforeAria", { index: index + 1 })}
                integer
                value={days}
                style={{ width: 72 }}
                onValue={(value) =>
                  set({
                    reminderDaysBefore: form.reminderDaysBefore.map((one, at) =>
                      at === index ? Math.max(0, value ?? 0) : one,
                    ),
                  })
                }
              />
              <Text size="sm" tone="mutedForeground" style={{ flex: 1 }}>
                {t("checkups.reminderDaysBeforeSuffix")}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${t("common.remove")} ${index + 1}`}
                hitSlop={space.sm}
                onPress={() =>
                  set({
                    reminderDaysBefore: form.reminderDaysBefore.filter((_, at) => at !== index),
                  })
                }
              >
                <Icon icon={X} />
              </Pressable>
            </View>
          ))}
          <Button
            variant="outline"
            label={t("checkups.addReminderDay")}
            onPress={() => set({ reminderDaysBefore: [...form.reminderDaysBefore, 1] })}
          />
        </Section>

        <Section title={t("checkups.why")}>
          <Input
            accessibilityLabel={t("checkups.why")}
            placeholder={t("checkups.whyPlaceholder")}
            value={form.whyText}
            onChangeText={(whyText) => set({ whyText })}
            multiline
            style={{ minHeight: 64, textAlignVertical: "top" }}
          />
          <Field label={t("checkups.linkedConditions")}>
            {conditions.data?.length ? (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
                {conditions.data.map((condition) => (
                  <Chip
                    key={condition.id}
                    label={condition.name}
                    selected={form.whyLinks.some((link) => link.id === condition.id)}
                    onPress={() => set({ whyLinks: toggleConditionLink(form.whyLinks, condition) })}
                  />
                ))}
              </View>
            ) : (
              <Text size="xs" tone="mutedForeground">
                {t("checkups.linkedConditionsEmpty")}
              </Text>
            )}
          </Field>
        </Section>
      </ScrollView>
    </>
  );
}
