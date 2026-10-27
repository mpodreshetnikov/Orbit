import {
  normalizeReminderTime,
  routingEnabled,
  routingUpsert,
  type RoutingChoice,
} from "@orbit-types/notification-routing";
import { Stack } from "expo-router";
import { Check } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, Switch, View } from "react-native";
import { Field, Input, Section } from "@/components/form";
import { Button, Icon, Placeholder, Text } from "@/components/ui";
import type { CheckupReminders, HouseholdPerson } from "@/features/settings";
import { TODAY_BLOCKS, type TodayBlock } from "@/features/today/blocks";
import { t } from "@/lib/i18n";
import {
  useChoosePerson,
  useHousehold,
  useNotificationSettings,
  usePerson,
  useSaveNotificationSettings,
  useSaveTodayBlocks,
  useTodayBlocks,
} from "@/lib/queries";
import { useSession } from "@/lib/session";
import { space } from "@/theme";

const fail = (error: Error) => Alert.alert(t("common.error"), error.message);

/**
 * "Настройки" — whose record the phone shows, which blocks "Сегодня" shows, and the web settings'
 * notification choices: when the daily checkup reminder comes and whose reminders reach this account.
 * Signing out lives here too.
 */
export default function SettingsScreen() {
  const { session, signOut } = useSession();
  const userId = session?.user.id ?? null;
  const person = usePerson();
  const household = useHousehold();
  const choose = useChoosePerson();
  const settings = useNotificationSettings();
  const header = <Stack.Screen options={{ title: t("nav.settings"), headerLargeTitle: false }} />;
  if (!household.data || !settings.data) {
    const busy = household.isPending || settings.isPending;
    return (
      <>
        {header}
        <Placeholder
          busy={busy}
          message={busy ? undefined : (household.error ?? settings.error)?.message}
          // Settings is the only way out of the account: a failed read must not hide it.
          action={
            busy ? undefined : (
              <View style={{ gap: space.sm }}>
                <Button
                  variant="outline"
                  label={t("common.retry")}
                  onPress={() => void (household.error ? household.refetch() : settings.refetch())}
                />
                <Button
                  variant="outline"
                  label={t("auth.signOut")}
                  onPress={() => void signOut()}
                />
              </View>
            )
          }
        />
      </>
    );
  }
  return (
    <>
      {header}
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xl * 2 }}
      >
        <Section title={t("nav.selectPerson")}>
          {household.data.map((one) => (
            <Pressable
              key={one.id}
              accessibilityRole="button"
              accessibilityState={{ selected: one.id === person.data?.id }}
              onPress={() => choose.mutate(one.id, { onError: fail })}
              style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 32 }}
            >
              <View style={{ flex: 1 }}>
                <Text weight="medium">{one.name}</Text>
                {one.kind === "pet" && one.species ? (
                  <Text size="xs" tone="mutedForeground">
                    {one.species}
                  </Text>
                ) : null}
              </View>
              {one.id === person.data?.id ? <Icon icon={Check} size={18} tone="primary" /> : null}
            </Pressable>
          ))}
        </Section>

        <TodayBlocksSection />

        <Reminders initial={settings.data.reminders} />

        <Section title={t("settings.pwa.routingTitle")}>
          <Text size="sm" tone="mutedForeground">
            {t("settings.pwa.routingDescription")}
          </Text>
          {household.data.map((one) => (
            <RoutingRow
              key={one.id}
              person={one}
              row={settings.data.routing.find((row) => row.person_id === one.id)}
              userId={userId}
            />
          ))}
        </Section>

        <Button variant="outline" label={t("auth.signOut")} onPress={() => void signOut()} />
      </ScrollView>
    </>
  );
}

const BLOCK_LABELS: Record<TodayBlock, string> = {
  doses: "today.blockDoses",
  checkups: "today.blockCheckups",
};

/** Which blocks "Сегодня" shows on this phone, each a switch. */
function TodayBlocksSection() {
  const blocks = useTodayBlocks();
  const save = useSaveTodayBlocks();
  if (!blocks.data) return null;
  const shown = blocks.data;
  return (
    <Section title={t("today.blocks")}>
      <Text size="sm" tone="mutedForeground">
        {t("today.blocksDescription")}
      </Text>
      {TODAY_BLOCKS.map((block) => (
        <View key={block} style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
          <Text weight="medium" style={{ flex: 1 }}>
            {t(BLOCK_LABELS[block])}
          </Text>
          <Switch
            accessibilityLabel={t(BLOCK_LABELS[block])}
            value={shown[block]}
            onValueChange={(on) => save.mutate({ ...shown, [block]: on }, { onError: fail })}
          />
        </View>
      ))}
    </Section>
  );
}

/** When the daily checkup reminder comes, in which time zone. */
function Reminders({ initial }: { initial: CheckupReminders }) {
  const save = useSaveNotificationSettings();
  const kept = initial.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [time, setTime] = useState(initial.time);
  const [timezone, setTimezone] = useState(kept);
  // A field follows a fresher read until it is typed in, so a save never sends a stale other half.
  const [edited, setEdited] = useState({ time: false, timezone: false });
  useEffect(() => {
    if (!edited.time) setTime(initial.time);
    // Only a fresher read: typing is what marks a field edited.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial.time]);
  useEffect(() => {
    if (!edited.timezone) setTimezone(kept);
    // Only a fresher read: typing is what marks a field edited.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kept]);
  const submit = () =>
    save.mutate(
      { reminders: { time: normalizeReminderTime(time), timezone: timezone.trim() || null } },
      {
        onSuccess: () => {
          setTime(normalizeReminderTime(time));
          setEdited({ time: false, timezone: false });
        },
        onError: fail,
      },
    );
  return (
    <Section title={t("settings.pwa.checkupReminders")}>
      <Field
        label={t("settings.pwa.notificationTime")}
        hint={t("settings.pwa.notificationTimeHint")}
      >
        <Input
          accessibilityLabel={t("settings.pwa.notificationTime")}
          keyboardType="numbers-and-punctuation"
          placeholder="09:00"
          value={time}
          onChangeText={(value) => {
            setEdited((was) => ({ ...was, time: true }));
            setTime(value);
          }}
        />
      </Field>
      <Field
        label={t("settings.pwa.notificationTimezone")}
        hint={t("settings.pwa.notificationTimezoneHint")}
      >
        <Input
          accessibilityLabel={t("settings.pwa.notificationTimezone")}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="UTC"
          value={timezone}
          onChangeText={(value) => {
            setEdited((was) => ({ ...was, timezone: true }));
            setTimezone(value);
          }}
        />
      </Field>
      <Button
        label={t("settings.pwa.saveCheckupReminders")}
        busy={save.isPending}
        onPress={submit}
      />
    </Section>
  );
}

/** One person: whether their reminders reach the account, and the title prefix they carry. */
function RoutingRow({
  person,
  row,
  userId,
}: {
  person: HouseholdPerson;
  row: RoutingChoice | undefined;
  userId: string | null;
}) {
  const save = useSaveNotificationSettings();
  const [prefix, setPrefix] = useState(row?.custom_prefix ?? "");
  const own = userId != null && person.auth_user_id === userId;
  const enabled = routingEnabled(row, person.auth_user_id, userId);
  const store = (on: boolean) =>
    save.mutate({ routing: routingUpsert(person.id, on, prefix, own) }, { onError: fail });
  return (
    <View style={{ gap: space.xs }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
        <Text weight="medium" style={{ flex: 1 }}>
          {person.name}
        </Text>
        <Switch
          accessibilityLabel={`${t("settings.pwa.notifications")}: ${person.name}`}
          value={enabled}
          disabled={save.isPending}
          onValueChange={store}
        />
      </View>
      {own ? null : (
        <Input
          accessibilityLabel={`${t("settings.pwa.routingPrefixLabel")}: ${person.name}`}
          placeholder={t("settings.pwa.routingPrefixPlaceholder")}
          value={prefix}
          editable={enabled && !save.isPending}
          onChangeText={setPrefix}
          onEndEditing={() => store(enabled)}
        />
      )}
    </View>
  );
}
