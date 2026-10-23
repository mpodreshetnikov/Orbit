import { MEASUREMENT_CATEGORIES, type MeasurementCategory } from "@orbit-types/measurement";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Alert, ScrollView, View } from "react-native";
import { Choice, Field, Input, NumberInput, Section } from "@/components/form";
import { Button, Placeholder } from "@/components/ui";
import { categoryLabel } from "@/features/measurements/format";
import type { CatalogColumns } from "@/features/measurements/query";
import { t } from "@/lib/i18n";
import { useMeasurementCatalog, useSaveCatalogEntry } from "@/lib/queries";
import { space } from "@/theme";

const EMPTY: CatalogColumns = {
  code: "",
  name_ru: "",
  name_en: "",
  unit_ru: "",
  unit_en: "",
  category: "body",
  sort_order: 0,
};

/** The fields the web dialog requires. */
const REQUIRED = new Set(["code", "name_ru", "name_en"]);

/** The text fields, in the web dialog's order. */
const TEXT_FIELDS: [keyof Omit<CatalogColumns, "category" | "sort_order">, string][] = [
  ["code", "catalogs.code"],
  ["name_ru", "catalogs.nameRu"],
  ["name_en", "catalogs.nameEn"],
  ["unit_ru", "catalogs.unitRu"],
  ["unit_en", "catalogs.unitEn"],
];

/** What the web dialog saves: trimmed, the code in lower case. */
export function catalogColumns(form: CatalogColumns): CatalogColumns {
  return {
    ...form,
    code: form.code.toLowerCase().trim(),
    name_ru: form.name_ru.trim(),
    name_en: form.name_en.trim(),
    unit_ru: form.unit_ru.trim(),
    unit_en: form.unit_en.trim(),
  };
}

/** A measurement type, new or being edited — the web catalogue dialog. */
export default function CatalogEntryFormScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const catalog = useMeasurementCatalog();
  const entry = id ? catalog.data?.find((one) => one.id === id) : undefined;
  if (!id || entry) return <CatalogEntryForm id={id} initial={entry ?? EMPTY} />;
  return (
    <>
      <Stack.Screen options={{ title: t("catalogs.editMeasurement"), headerLargeTitle: false }} />
      <Placeholder
        busy={catalog.isPending}
        message={catalog.isPending ? undefined : (catalog.error?.message ?? t("common.noResults"))}
        action={
          catalog.error ? (
            <Button
              variant="outline"
              label={t("common.retry")}
              onPress={() => void catalog.refetch()}
            />
          ) : undefined
        }
      />
    </>
  );
}

function CatalogEntryForm({ id, initial }: { id?: string; initial: CatalogColumns }) {
  const router = useRouter();
  const save = useSaveCatalogEntry();
  const [form, setForm] = useState<CatalogColumns>(() => catalogColumns(initial));
  const [missing, setMissing] = useState(false);

  const submit = () => {
    const columns = catalogColumns(form);
    if (!columns.code || !columns.name_ru || !columns.name_en) {
      setMissing(true);
      return;
    }
    save.mutate(
      { id, columns },
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
          title: t(id ? "catalogs.editMeasurement" : "catalogs.addMeasurement"),
          headerLargeTitle: false,
          headerLeft: () => (
            <Button compact variant="ghost" label={t("common.cancel")} onPress={router.back} />
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
      <ScrollView
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xl * 2 }}
      >
        <Section
          title={t(
            id ? "catalogs.editMeasurementDescription" : "catalogs.addMeasurementDescription",
          )}
        >
          {TEXT_FIELDS.map(([key, label]) => (
            <Field
              key={key}
              label={t(label)}
              error={
                missing && REQUIRED.has(key) && !form[key].trim() ? t("common.required") : undefined
              }
            >
              <Input
                accessibilityLabel={t(label)}
                value={form[key]}
                // Hidden types and links are keyed by the code, so an entry keeps its own (as on the web).
                editable={!(id && key === "code")}
                autoCapitalize={key === "code" ? "none" : "sentences"}
                onChangeText={(text) => setForm((current) => ({ ...current, [key]: text }))}
              />
            </Field>
          ))}
          <View style={{ flexDirection: "row", gap: space.md }}>
            <Field label={t("catalogs.category")} flex>
              <Choice<MeasurementCategory>
                label={t("catalogs.category")}
                value={form.category}
                options={MEASUREMENT_CATEGORIES.map((category) => [
                  category,
                  categoryLabel(category),
                ])}
                onPick={(category) => setForm((current) => ({ ...current, category }))}
              />
            </Field>
            <Field label={t("catalogs.sortOrder")} flex>
              <NumberInput
                accessibilityLabel={t("catalogs.sortOrder")}
                integer
                value={form.sort_order}
                onValue={(order) => setForm((current) => ({ ...current, sort_order: order ?? 0 }))}
              />
            </Field>
          </View>
        </Section>
      </ScrollView>
    </>
  );
}
