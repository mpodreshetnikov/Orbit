import type { Condition, IcdLookupResult, UpdateConditionInput } from "@orbit-types/condition";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { AlertTriangle, Check, ExternalLink } from "lucide-react-native";
import { useState } from "react";
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, View } from "react-native";
import { Field, Input, Section } from "@/components/form";
import { Button, Icon, Placeholder, Text } from "@/components/ui";
import { t } from "@/lib/i18n";
import { useCondition, useIcdLookup, useSaveCondition } from "@/lib/queries";
import { space } from "@/theme";

/**
 * The official name saved with a code: what the lookup found, nothing when it found nothing, and,
 * while it has not answered, the name already saved if the code is the one it was saved for.
 */
export function icdNameFor(
  code: string,
  lookup: IcdLookupResult | undefined,
  initial: Pick<Condition, "code" | "icd_name_en">,
): string | null {
  if (!code) return null;
  if (lookup) return lookup.found ? lookup.name_en : null;
  return code === initial.code ? initial.icd_name_en : null;
}

/** Editing a condition's name, ICD code and notes — the web condition page's edit dialog. */
export default function ConditionFormScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const condition = useCondition(id);
  if (condition.data) return <ConditionForm initial={condition.data} />;
  return (
    <>
      <Stack.Screen options={{ title: t("conditions.edit"), headerLargeTitle: false }} />
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

function ConditionForm({ initial }: { initial: Condition }) {
  const router = useRouter();
  const save = useSaveCondition();
  const [name, setName] = useState(initial.name);
  const [code, setCode] = useState(initial.code ?? "");
  const [notes, setNotes] = useState(initial.notes ?? "");
  const trimmedCode = code.trim();
  const lookup = useIcdLookup(trimmedCode);

  const submit = () => {
    const values: UpdateConditionInput = {
      name: name.trim(),
      code: trimmedCode || null,
      icd_name_en: icdNameFor(trimmedCode, lookup.data, initial),
      notes: notes.trim() || null,
    };
    save.mutate(
      { id: initial.id, values },
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
          title: t("conditions.edit"),
          headerLargeTitle: false,
          headerLeft: () => (
            <Button compact variant="ghost" label={t("common.cancel")} onPress={router.back} />
          ),
          headerRight: () => (
            <Button
              compact
              variant="ghost"
              label={t("common.save")}
              // The official name comes from the lookup: wait for it rather than save without it.
              busy={save.isPending || lookup.isFetching}
              disabled={!name.trim()}
              onPress={submit}
            />
          ),
        }}
      />
      <ScrollView
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xl * 2 }}
      >
        <Section title={t("conditions.editDescription")}>
          <Field
            label={t("conditions.name")}
            error={name.trim() ? undefined : t("common.required")}
          >
            <Input accessibilityLabel={t("conditions.name")} value={name} onChangeText={setName} />
          </Field>
          <Field label={t("conditions.icdCode")}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
              <Input
                accessibilityLabel={t("conditions.icdCode")}
                value={code}
                placeholder="H52.1"
                autoCapitalize="characters"
                autoCorrect={false}
                onChangeText={(text) => setCode(text.toUpperCase())}
                style={{ width: 110 }}
              />
              {lookup.isFetching ? <ActivityIndicator /> : null}
              {lookup.data?.found ? (
                <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <Icon icon={Check} tone="success" />
                  <Text size="sm" tone="success" numberOfLines={2} style={{ flex: 1 }}>
                    {lookup.data.name_en}
                  </Text>
                </View>
              ) : lookup.data ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <Icon icon={AlertTriangle} tone="warningText" />
                  <Text size="sm" tone="warningText">
                    {t("conditions.icdNotFound")}
                  </Text>
                </View>
              ) : null}
            </View>
            {name.trim() ? (
              <Pressable
                accessibilityRole="link"
                onPress={() =>
                  void Linking.openURL(
                    `https://www.google.com/search?q=${encodeURIComponent(`${name.trim()} ICD-10 code`)}`,
                  )
                }
                style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
              >
                <Icon icon={ExternalLink} size={12} />
                <Text size="xs" tone="mutedForeground">
                  {t("conditions.findIcdCode")}
                </Text>
              </Pressable>
            ) : null}
          </Field>
          <Field label={t("conditions.notes")}>
            <Input
              accessibilityLabel={t("conditions.notes")}
              testID="condition-notes"
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
