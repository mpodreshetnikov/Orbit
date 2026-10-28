import { Stack } from "expo-router";
import { Plus, Trash2 } from "lucide-react-native";
import { useState } from "react";
import { Alert, Pressable, ScrollView, View } from "react-native";
import { Input, Section } from "@/components/form";
import { Button, Icon, Text } from "@/components/ui";
import { t } from "@/lib/i18n";
import { usePerson, useSaveSelfAlias, useSelfAliases } from "@/lib/queries";
import { space } from "@/theme";

/**
 * "Псевдонимы для переводов себе" — the alias manager of the web accounts page, where it moved from
 * the report (T-261028-yhm): the names the person's own transfers go by, so that the report does
 * not count moving money between their accounts.
 */
export default function SelfAliasesScreen() {
  const person = usePerson();
  const aliases = useSelfAliases(person.data?.id);
  const save = useSaveSelfAlias();
  const [draft, setDraft] = useState("");
  const [invalid, setInvalid] = useState(false);
  const fail = (error: Error) => Alert.alert(t("common.error"), error.message);
  const add = () => {
    const alias = draft.trim();
    setInvalid(!alias);
    if (!alias || !person.data) return;
    save.mutate(
      { personId: person.data.id, alias },
      { onSuccess: () => setDraft(""), onError: fail },
    );
  };
  return (
    <>
      <Stack.Screen options={{ title: t("money.reportSelfAliases"), headerLargeTitle: false }} />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xl * 2 }}
      >
        <Text size="sm" tone="mutedForeground">
          {t("money.reportSelfAliasesDescription")}
        </Text>
        <View style={{ flexDirection: "row", gap: space.sm }}>
          <Input
            accessibilityLabel={t("money.reportSelfAliases")}
            placeholder={t("money.reportAliasPlaceholder")}
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={add}
            style={{ flex: 1 }}
          />
          <Button icon={Plus} label={t("common.add")} busy={save.isPending} onPress={add} />
        </View>
        {invalid ? (
          <Text size="xs" tone="destructive">
            {t("money.reportAliasValidation")}
          </Text>
        ) : null}
        <Section title={t("money.reportSelfAliases")}>
          {aliases.data?.length ? (
            aliases.data.map((alias) => (
              <View
                key={alias.id}
                style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}
              >
                <View style={{ flex: 1 }}>
                  <Text weight="medium">{alias.alias}</Text>
                  {alias.normalized_alias ? (
                    <Text size="xs" tone="mutedForeground">
                      {alias.normalized_alias}
                    </Text>
                  ) : null}
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${t("common.delete")}: ${alias.alias}`}
                  hitSlop={space.sm}
                  onPress={() => save.mutate({ id: alias.id }, { onError: fail })}
                >
                  <Icon icon={Trash2} size={18} tone="destructive" />
                </Pressable>
              </View>
            ))
          ) : (
            <Text size="sm" tone="mutedForeground">
              {aliases.error?.message ?? t("money.reportAliasesEmpty")}
            </Text>
          )}
        </Section>
      </ScrollView>
    </>
  );
}
