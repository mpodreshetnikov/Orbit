import DateTimePicker from "@react-native-community/datetimepicker";
import {
  INTAKE_ADVICE_OPTIONS,
  MEDICATION_UNITS,
  medicationUnitKey,
  type MedicationKind,
  type MedicationUnit,
} from "@orbit-types/medication";
import { toPositiveAmount, type MedRegimen } from "@orbit-types/regimen";
import {
  getReminderSlotsForIntakesPerDay,
  reminderSlots,
  scheduleForMode,
  withDayToggled,
  withIntervalEvery,
  withSlotAdded,
  withSlotChanged,
  withSlotRemoved,
} from "@orbit-types/regimen-form";
import type { MedDuration, MedSchedule, MedScheduleDaysOfWeek } from "@orbit-types/regimen";
import { Stack, useLocalSearchParams, useRouter, type Href } from "expo-router";
import { X } from "lucide-react-native";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Alert, Pressable, ScrollView, Switch, View } from "react-native";
import { Chip, Choice, Field, Input, NumberInput, Section } from "@/components/form";
import { Button, Icon, Placeholder, Text } from "@/components/ui";
import { intakeAdviceLabel } from "@/features/medications/format";
import {
  editedCourseColumns,
  formProblem,
  initialCourseForm,
  newCourseSubmission,
  noonOf,
  slotTime,
  timeOnDay,
  type CourseForm,
  type FormProblem,
} from "@/features/medications/form";
import { t } from "@/lib/i18n";
import { dayKey, usePerson, useRegimen, useRegimens, useSaveCourse } from "@/lib/queries";
import { space, usePalette } from "@/theme";

/** Units a per-unit strength is commonly written in, as the web form offers them. */
const STRENGTH_UNITS = ["milligram", "microgram", "gram", "iu", "ml"];
const DAY_KEYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const FREQUENCIES: [Exclude<MedSchedule["mode"], "one_off">, string][] = [
  ["daily_times", "medications.frequencyDaily"],
  ["interval_hours", "medications.everyXHours"],
  ["interval_days", "medications.everyXDays"],
  ["days_of_week", "medications.frequencyDaysOfWeek"],
];
const END_TYPES: [MedDuration["type"], string][] = [
  ["endless", "medications.endTypeEndless"],
  ["until_date", "medications.endTypeEndDate"],
  ["for_days", "medications.endTypeDaysFromStart"],
];
const NO_ADVICE = "__none__";
const STOCK_LABELS = {
  current: "medications.inventoryCurrent",
  refillThreshold: "medications.inventoryRefillThreshold",
};

function unitLabel(unit: MedicationUnit): string {
  return t(medicationUnitKey(unit), { count: 1 });
}

function strengthUnitLabel(unit: string): string {
  if (unit === "microgram") return t("medications.unitMicrogram");
  return (MEDICATION_UNITS as string[]).includes(unit) ? unitLabel(unit as MedicationUnit) : unit;
}

function adviceLabel(advice: string): string {
  if (advice === "custom") return t("medications.intakeAdviceCustom");
  return intakeAdviceLabel({ intake_advice_type: advice }) ?? t("medications.intakeAdviceNone");
}

/**
 * A new course, or one being edited — the web app's medication form, the same fields in the same
 * order and saving the same columns.
 *
 * The web form's four wizard steps on a phone become one scroll of its four sections; its selects are
 * the system's sheet, its date and time inputs the compact pickers that open in place. A one-off
 * intake asks only what it needs: the name, with the person's courses offered under it so the intake
 * goes into the course it belongs to, the moment and the amount.
 */
export default function CourseFormScreen() {
  const { id, kind } = useLocalSearchParams<{ id?: string; kind?: string }>();
  return id ? (
    <EditCourse id={id} />
  ) : (
    <CourseFormBody initial={null} kind={kind === "one_time" ? "one_time" : "regular"} />
  );
}

function EditCourse({ id }: { id: string }) {
  const regimen = useRegimen(id);
  if (regimen.data) return <CourseFormBody initial={regimen.data} kind="regular" />;
  return (
    <>
      <Stack.Screen options={{ title: t("medications.edit"), headerLargeTitle: false }} />
      {regimen.isPending ? (
        <Placeholder busy />
      ) : (
        <Placeholder message={regimen.error?.message ?? t("common.noResults")} />
      )}
    </>
  );
}

function CourseFormBody({ initial, kind }: { initial: MedRegimen | null; kind: MedicationKind }) {
  const router = useRouter();
  const palette = usePalette();
  const person = usePerson();
  const courses = useRegimens(person.data?.id);
  const save = useSaveCourse();
  const [form, setForm] = useState<CourseForm>(() => initialCourseForm(initial, kind, new Date()));
  const [problem, setProblem] = useState<FormProblem | null>(null);
  const lastWeekly = useRef<MedScheduleDaysOfWeek | null>(null);
  const creating = !initial;
  const oneTime = form.kind === "one_time";
  const base = toPositiveAmount(initial?.dose_definition?.intake?.amount);
  const { schedule, duration } = form;

  useEffect(() => {
    if (schedule.mode === "days_of_week") lastWeekly.current = schedule;
  }, [schedule]);

  const set = (patch: Partial<CourseForm>) => {
    setProblem(null);
    setForm((current) => ({ ...current, ...patch }));
  };
  const setSchedule = (next: MedSchedule) => set({ schedule: next });

  const submit = () => {
    const found = formProblem(form, creating);
    setProblem(found);
    const personId = initial?.person_id ?? person.data?.id;
    if (found || !personId) return;
    const onError = (error: Error) => Alert.alert(t("common.error"), error.message);
    if (initial) {
      save.mutate(
        { course: initial, columns: editedCourseColumns(form, initial) },
        { onSuccess: () => router.back(), onError },
      );
      return;
    }
    save.mutate(
      { personId, submission: newCourseSubmission(form, personId, courses.data) },
      {
        onSuccess: (courseId) => {
          router.back();
          router.push(`/medications/${courseId}` as Href);
        },
        onError,
      },
    );
  };

  const error = (field: FormProblem["field"]) =>
    problem?.field === field ? t(problem.message) : undefined;

  const matching =
    oneTime && creating
      ? (courses.data ?? []).filter((course) =>
          course.custom_name.trim().toLowerCase().includes(form.name.trim().toLowerCase()),
        )
      : [];

  const header = (
    <Stack.Screen
      options={{
        title: initial ? t("medications.edit") : t("medications.add"),
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

  const basic = (
    <Section title={t("medications.sectionBasic")}>
      <Field label={t("medications.name")} error={error("name")}>
        <Input
          accessibilityLabel={t("medications.name")}
          value={form.name}
          onChangeText={(name) => set({ name, picked: null })}
          placeholder={t("medications.namePlaceholder")}
          autoFocus={creating}
        />
        {matching.length > 0 ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
            {matching.map((course) => (
              <Chip
                key={course.id}
                label={course.custom_name}
                selected={form.picked === course.id}
                onPress={() =>
                  set({
                    name: course.custom_name,
                    unit: course.intake_unit ?? form.unit,
                    picked: form.picked === course.id ? null : course.id,
                  })
                }
              />
            ))}
          </View>
        ) : null}
      </Field>
      <Field label={t("medications.unit")}>
        <Choice
          label={t("medications.unit")}
          value={form.unit}
          options={MEDICATION_UNITS.map((unit) => [unit, unitLabel(unit)])}
          onPick={(unit) => set({ unit })}
        />
      </Field>
      {oneTime ? (
        <>
          <Field label={t("medications.scheduledAt")} error={error("scheduledAt")}>
            <DateTimePicker
              testID="scheduled-at"
              value={form.scheduledAt ?? new Date()}
              mode="datetime"
              display="compact"
              locale="ru"
              style={{ alignSelf: "flex-start" }}
              onValueChange={(_event, date) => set({ scheduledAt: date })}
            />
          </Field>
          <Field label={t("medications.oneTimeAmount")}>
            <NumberInput
              accessibilityLabel={t("medications.oneTimeAmount")}
              value={form.oneTimeAmount}
              onValue={(amount) => amount != null && set({ oneTimeAmount: amount })}
            />
          </Field>
        </>
      ) : null}
      <Field label={`${t("medications.dosePerUnit")} ${t("common.optional")}`}>
        <View style={{ flexDirection: "row", gap: space.sm }}>
          <NumberInput
            accessibilityLabel={t("medications.dosePerUnit")}
            value={form.strength.amount}
            onValue={(amount) => set({ strength: { ...form.strength, amount } })}
            placeholder={t("medications.dosePerUnitPlaceholder")}
            style={{ flex: 1 }}
          />
          <View style={{ flex: 1 }}>
            <Choice
              label={t("medications.strengthUnit")}
              value={form.strength.unit}
              options={(STRENGTH_UNITS.includes(form.strength.unit)
                ? STRENGTH_UNITS
                : [...STRENGTH_UNITS, form.strength.unit]
              ).map((unit) => [unit, strengthUnitLabel(unit)])}
              onPick={(unit) => set({ strength: { ...form.strength, unit } })}
            />
          </View>
        </View>
      </Field>
      <Field label={`${t("medications.activeIngredient")} ${t("common.optional")}`}>
        <Input
          accessibilityLabel={t("medications.activeIngredient")}
          value={form.strength.name}
          onChangeText={(name) => set({ strength: { ...form.strength, name } })}
          placeholder={t("medications.activeIngredientPlaceholder")}
        />
      </Field>
    </Section>
  );

  const slots = reminderSlots(schedule, base);
  const every = "interval" in schedule ? (schedule.interval?.every ?? 1) : 1;
  const scheduleSection = (
    <Section title={t("medications.sectionSchedule")}>
      <Field label={t("medications.frequency")}>
        <Choice
          label={t("medications.frequency")}
          value={schedule.mode as (typeof FREQUENCIES)[number][0]}
          options={FREQUENCIES.map(([mode, key]) => [mode, t(key)])}
          onPick={(mode) => setSchedule(scheduleForMode(mode, schedule, lastWeekly.current))}
        />
      </Field>
      {schedule.mode === "interval_hours" || schedule.mode === "interval_days" ? (
        <Row>
          <NumberInput
            integer
            accessibilityLabel={
              schedule.mode === "interval_hours" ? t("medications.hours") : t("medications.days")
            }
            value={every}
            onValue={(n) =>
              n != null && setSchedule(withIntervalEvery(schedule, toPositiveAmount(n)))
            }
            style={{ width: 72 }}
          />
          <Text tone="mutedForeground">
            {schedule.mode === "interval_hours" ? t("medications.hours") : t("medications.days")}
          </Text>
        </Row>
      ) : null}
      {schedule.mode === "interval_hours" ? (
        <Field label={t("medications.amountPerIntake")}>
          <NumberInput
            accessibilityLabel={t("medications.amountPerIntake")}
            value={toPositiveAmount(schedule.amount)}
            onValue={(n) => n != null && setSchedule({ ...schedule, amount: toPositiveAmount(n) })}
            style={{ width: 96 }}
          />
        </Field>
      ) : null}
      {schedule.mode === "days_of_week" ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.xs }}>
          {DAY_KEYS.map((key, day) => (
            <Chip
              key={key}
              label={t(`medications.day${key}`)}
              selected={schedule.days_of_week?.includes(day) ?? false}
              onPress={() => setSchedule(withDayToggled(schedule, day))}
            />
          ))}
        </View>
      ) : null}
      {slots.length > 0 ? (
        <Field label={t("medications.reminderTimes")} error={error("slots")}>
          <Row>
            <Text size="xs" tone="mutedForeground">
              {t("medications.quickSetIntakes")}
            </Text>
            {[1, 2, 3, 4, 5].map((count) => (
              <Chip
                key={count}
                label={String(count)}
                selected={slots.length === count}
                onPress={() => {
                  const preset = getReminderSlotsForIntakesPerDay(count);
                  setSchedule({
                    ...schedule,
                    times: preset.map((slot) => slot.time),
                    amounts: preset.map((slot) => slot.amount),
                  } as MedSchedule);
                }}
              />
            ))}
          </Row>
          {slots.map((slot, index) => (
            <Row key={index}>
              <DateTimePicker
                testID={`slot-time-${index}`}
                value={timeOnDay(slot.time, new Date())}
                mode="time"
                display="compact"
                locale="ru"
                onValueChange={(_event, date) =>
                  setSchedule(withSlotChanged(schedule, index, "time", slotTime(date), base))
                }
              />
              <NumberInput
                accessibilityLabel={`${t("medications.amountPerIntake")} ${index + 1}`}
                value={slot.amount}
                onValue={(n) =>
                  n != null &&
                  setSchedule(withSlotChanged(schedule, index, "amount", toPositiveAmount(n), base))
                }
                style={{ width: 72 }}
              />
              {slots.length > 1 ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${t("common.delete")}: ${slot.time}`}
                  hitSlop={space.sm}
                  onPress={() => setSchedule(withSlotRemoved(schedule, index, base))}
                >
                  <Icon icon={X} />
                </Pressable>
              ) : null}
            </Row>
          ))}
          <Button
            compact
            variant="outline"
            label={t("medications.addReminder")}
            onPress={() => setSchedule(withSlotAdded(schedule, base))}
          />
        </Field>
      ) : null}
      <Field label={t("medications.startDate")}>
        <DateTimePicker
          testID="start-date"
          value={noonOf(form.startDate)}
          mode="date"
          display="compact"
          locale="ru"
          style={{ alignSelf: "flex-start" }}
          onValueChange={(_event, date) => set({ startDate: dayKey(date) })}
        />
      </Field>
      <Field label={t("medications.endType")} error={error("duration")}>
        <Choice
          label={t("medications.endType")}
          value={duration.type}
          options={END_TYPES.map(([type, key]) => [type, t(key)])}
          onPick={(type) =>
            set({
              duration:
                type === "until_date"
                  ? { type, end_date: duration.type === "until_date" ? duration.end_date : "" }
                  : type === "for_days"
                    ? { type, days: duration.type === "for_days" ? duration.days : 1 }
                    : { type },
            })
          }
        />
        {duration.type === "until_date" ? (
          <DateTimePicker
            testID="end-date"
            value={duration.end_date ? noonOf(duration.end_date) : noonOf(form.startDate)}
            mode="date"
            display="compact"
            locale="ru"
            minimumDate={noonOf(form.startDate)}
            style={{ alignSelf: "flex-start" }}
            onValueChange={(_event, date) =>
              set({ duration: { ...duration, end_date: dayKey(date) } })
            }
          />
        ) : null}
        {duration.type === "for_days" ? (
          <Row>
            <NumberInput
              integer
              accessibilityLabel={t("medications.daysFromStartCount")}
              value={duration.days || null}
              onValue={(days) => set({ duration: { ...duration, days: days ?? 0 } })}
              style={{ width: 96 }}
            />
            <Text tone="mutedForeground">{t("medications.days")}</Text>
          </Row>
        ) : null}
      </Field>
    </Section>
  );

  const stock = (
    <Section title={t("medications.sectionStock")}>
      <Row>
        <Text style={{ flex: 1 }}>{t("medications.inventoryEnabled")}</Text>
        <Switch
          accessibilityLabel={t("medications.inventoryEnabled")}
          value={form.inventory.enabled}
          trackColor={{ true: palette.primary }}
          onValueChange={(enabled) => set({ inventory: { ...form.inventory, enabled } })}
        />
      </Row>
      {form.inventory.enabled ? (
        <Row>
          {(["current", "refillThreshold"] as const).map((key) => (
            <Field key={key} label={t(STOCK_LABELS[key])} flex>
              <Input
                accessibilityLabel={t(STOCK_LABELS[key])}
                keyboardType="decimal-pad"
                value={form.inventory[key]}
                onChangeText={(typed) => set({ inventory: { ...form.inventory, [key]: typed } })}
              />
            </Field>
          ))}
        </Row>
      ) : null}
    </Section>
  );

  const other = (
    <Section title={t("medications.sectionOther")}>
      {oneTime ? null : (
        <Field label={t("medications.intakeAdvice")}>
          <Choice
            label={t("medications.intakeAdvice")}
            value={form.intakeAdvice || NO_ADVICE}
            options={[NO_ADVICE, ...INTAKE_ADVICE_OPTIONS].map((one) => [one, adviceLabel(one)])}
            onPick={(intakeAdvice) => set({ intakeAdvice })}
          />
          {form.intakeAdvice === "custom" ? (
            <Input
              accessibilityLabel={t("medications.intakeAdviceCustom")}
              value={form.intakeAdviceCustom}
              onChangeText={(intakeAdviceCustom) => set({ intakeAdviceCustom })}
            />
          ) : null}
        </Field>
      )}
      <Field label={t("medications.notes")}>
        <Input
          accessibilityLabel={t("medications.notes")}
          value={form.notes}
          onChangeText={(notes) => set({ notes })}
          placeholder={t("medications.notesPlaceholder")}
          multiline
          style={{ minHeight: 80, textAlignVertical: "top" }}
        />
      </Field>
    </Section>
  );

  return (
    <>
      {header}
      <ScrollView
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: space.lg, gap: space.xl, paddingBottom: space.xl * 3 }}
      >
        {basic}
        {oneTime ? null : scheduleSection}
        {oneTime ? null : stock}
        {other}
      </ScrollView>
    </>
  );
}

function Row({ children }: { children: ReactNode }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.sm }}>
      {children}
    </View>
  );
}
