import { addSynonym, matchesCatalogEntry, parentCandidates } from "@orbit-types/clinical-catalog";
import type { BodySiteCatalog } from "@orbit-types/finding";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Check, Plus, X } from "lucide-react-native";
import { useState } from "react";
import { Alert, Pressable, ScrollView, View } from "react-native";
import { Field, Input, Section } from "@/components/form";
import { Button, Icon, Placeholder, Text } from "@/components/ui";
import type {
  ClinicalCatalogKind,
  ClinicalColumns,
  ClinicalEntry,
} from "@/features/catalogs/query";
import { t } from "@/lib/i18n";
import { useClinicalCatalog, useSaveClinicalEntry } from "@/lib/queries";
import { CLINICAL_CATALOG } from "@/screens/clinical-catalog-screen";
import { radius, space, usePalette } from "@/theme";

const EMPTY: ClinicalColumns = {
  code: "",
  name_ru: "",
  name_en: "",
  parent_code: null,
  synonyms_ru: [],
  synonyms_en: [],
  notes: null,
};

/** The web dialogs' placeholders, by catalogue. */
const PLACEHOLDERS = {
  "finding-types": { code: "polyp", name_ru: "Полип", name_en: "Polyp" },
  "body-sites": { code: "kidney_left", name_ru: "Левая почка", name_en: "Left kidney" },
} as const;

/** How many parents the search offers at once. */
const SHOWN_PARENTS = 8;

/** What the web dialogs save: trimmed, the code in lower case, empty notes as none. */
export function clinicalColumns(form: ClinicalColumns): ClinicalColumns {
  return {
    synonyms_ru: form.synonyms_ru,
    synonyms_en: form.synonyms_en,
    code: form.code.trim().toLowerCase(),
    name_ru: form.name_ru.trim(),
    name_en: form.name_en.trim(),
    parent_code: form.parent_code || null,
    notes: form.notes?.trim() || null,
  };
}

/** A finding type or body site, new or being edited by `?id=` — the web catalogue dialogs. */
export default function ClinicalCatalogFormScreen({ kind }: { kind: ClinicalCatalogKind }) {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const catalog = useClinicalCatalog(kind);
  const entry = id ? catalog.data?.find((one) => one.id === id) : undefined;
  if (catalog.data && (!id || entry)) {
    return <ClinicalForm kind={kind} entry={entry} all={catalog.data} />;
  }
  const busy = catalog.isPending;
  return (
    <>
      <Stack.Screen options={{ title: t(CLINICAL_CATALOG[kind].edit), headerLargeTitle: false }} />
      {catalog.error ? (
        <Placeholder
          message={catalog.error.message}
          action={
            <Button
              variant="outline"
              label={t("common.retry")}
              onPress={() => void catalog.refetch()}
            />
          }
        />
      ) : (
        <Placeholder busy={busy} message={busy ? undefined : t("common.noResults")} />
      )}
    </>
  );
}

function ClinicalForm({
  kind,
  entry,
  all,
}: {
  kind: ClinicalCatalogKind;
  entry?: ClinicalEntry;
  all: ClinicalEntry[];
}) {
  const router = useRouter();
  const save = useSaveClinicalEntry(kind);
  const [form, setForm] = useState<ClinicalColumns>(() => clinicalColumns({ ...EMPTY, ...entry }));
  const [missing, setMissing] = useState(false);
  const set = (changes: Partial<ClinicalColumns>) =>
    setForm((current) => ({ ...current, ...changes }));
  const placeholder = PLACEHOLDERS[kind];

  const submit = () => {
    const columns = clinicalColumns(form);
    if (!columns.code || !columns.name_ru || !columns.name_en) {
      setMissing(true);
      return;
    }
    save.mutate(
      { id: entry?.id, columns },
      {
        onSuccess: () => router.back(),
        onError: (error) => Alert.alert(t("common.error"), error.message),
      },
    );
  };

  const text = (key: "code" | "name_ru" | "name_en", label: string) => (
    <Field label={t(label)} error={missing && !form[key].trim() ? t("common.required") : undefined}>
      <Input
        accessibilityLabel={t(label)}
        placeholder={placeholder[key]}
        value={form[key]}
        autoCapitalize={key === "code" ? "none" : "sentences"}
        // A code is fixed once the entry exists (see saveClinicalEntry).
        editable={!(entry && key === "code")}
        onChangeText={(value) => set({ [key]: value })}
      />
    </Field>
  );

  return (
    <>
      <Stack.Screen
        options={{
          title: t(entry ? CLINICAL_CATALOG[kind].edit : CLINICAL_CATALOG[kind].add),
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
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xl * 2 }}
      >
        <Section
          title={t(
            kind === "finding-types"
              ? "catalogs.findingTypeDialogDescription"
              : "catalogs.bodySiteDialogDescription",
          )}
        >
          {text("code", "catalogs.code")}
          {text("name_ru", "catalogs.nameRu")}
          {text("name_en", "catalogs.nameEn")}
          {kind === "body-sites" ? (
            <ParentPicker
              all={all}
              entry={entry}
              value={form.parent_code}
              onPick={(parent_code) => set({ parent_code })}
            />
          ) : null}
        </Section>
        <Section title={t("catalogs.synonyms")}>
          <Synonyms
            label={t("catalogs.synonymsRu")}
            value={form.synonyms_ru}
            onChange={(synonyms_ru) => set({ synonyms_ru })}
          />
          <Synonyms
            label={t("catalogs.synonymsEn")}
            value={form.synonyms_en}
            onChange={(synonyms_en) => set({ synonyms_en })}
          />
        </Section>
        <Section title={t("catalogs.notes")}>
          <Input
            accessibilityLabel={t("catalogs.notes")}
            placeholder={t("catalogs.notesPlaceholder")}
            value={form.notes ?? ""}
            onChangeText={(notes) => set({ notes })}
            multiline
            style={{ minHeight: 64, textAlignVertical: "top" }}
          />
        </Section>
      </ScrollView>
    </>
  );
}

/** A list of synonyms: typed and added with "+", each removed with its cross. */
function Synonyms({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string[];
  onChange: (synonyms: string[]) => void;
}) {
  const palette = usePalette();
  const [draft, setDraft] = useState("");
  const add = () => {
    const next = addSynonym(value, draft);
    if (!next) return;
    onChange(next);
    setDraft("");
  };
  return (
    <Field label={label}>
      <View style={{ flexDirection: "row", gap: space.sm }}>
        <Input
          accessibilityLabel={label}
          placeholder={t("catalogs.addSynonym")}
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={add}
          autoCapitalize="none"
          style={{ flex: 1 }}
        />
        <Button
          variant="outline"
          icon={Plus}
          accessibilityLabel={`${label}: ${t("catalogs.add")}`}
          style={{ width: 40 }}
          onPress={add}
        />
      </View>
      {value.length > 0 ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.xs }}>
          {value.map((synonym) => (
            <Pressable
              key={synonym}
              accessibilityRole="button"
              accessibilityLabel={`${t("common.remove")} ${synonym}`}
              onPress={() => onChange(value.filter((one) => one !== synonym))}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: space.xs,
                paddingHorizontal: space.sm,
                paddingVertical: 4,
                borderRadius: 999,
                backgroundColor: palette.muted,
              }}
            >
              <Text size="sm">{synonym}</Text>
              <Icon icon={X} size={12} />
            </Pressable>
          ))}
        </View>
      ) : null}
    </Field>
  );
}

/** The web dialog's parent combobox: the parent picked, and a search over the sites it may be. */
function ParentPicker({
  all,
  entry,
  value,
  onPick,
}: {
  all: ClinicalEntry[];
  entry?: ClinicalEntry;
  value: string | null;
  onPick: (code: string | null) => void;
}) {
  const palette = usePalette();
  const [search, setSearch] = useState("");
  const parent = all.find((one) => one.code === value);
  const sites = all.map(toSite);
  const matches = search.trim()
    ? parentCandidates(sites, entry && toSite(entry))
        .filter((site) => matchesCatalogEntry(site.site_code, site, search))
        .slice(0, SHOWN_PARENTS)
    : [];
  const pick = (code: string | null) => {
    onPick(code);
    setSearch("");
  };
  return (
    <Field label={t("catalogs.parentSite")}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: space.sm,
          padding: space.sm,
          borderRadius: radius.md,
          backgroundColor: palette.mutedHalf,
        }}
      >
        <Text size="sm" tone={parent ? "foreground" : "mutedForeground"} style={{ flex: 1 }}>
          {parent ? `${parent.name_ru} (${parent.code})` : t("catalogs.noParent")}
        </Text>
        {parent ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("catalogs.noParent")}
            hitSlop={space.sm}
            onPress={() => pick(null)}
          >
            <Icon icon={X} size={14} />
          </Pressable>
        ) : null}
      </View>
      <Input
        accessibilityLabel={t("catalogs.selectParentSite")}
        placeholder={t("catalogs.selectParentSite")}
        value={search}
        onChangeText={setSearch}
        autoCapitalize="none"
      />
      {matches.map((site) => (
        <Pressable
          key={site.site_code}
          accessibilityRole="button"
          onPress={() => pick(site.site_code)}
          style={{ flexDirection: "row", alignItems: "center", gap: space.sm, padding: space.xs }}
        >
          <View style={{ opacity: site.site_code === value ? 1 : 0 }}>
            <Icon icon={Check} size={14} />
          </View>
          <View style={{ flex: 1 }}>
            <Text size="sm">{site.name_ru}</Text>
            <Text size="xs" tone="mutedForeground">
              {site.site_code}
            </Text>
          </View>
        </Pressable>
      ))}
      {search.trim() && matches.length === 0 ? (
        <Text size="xs" tone="mutedForeground">
          {t("catalogs.noSearchResults")}
        </Text>
      ) : null}
    </Field>
  );
}

function toSite(entry: ClinicalEntry): BodySiteCatalog {
  return {
    ...entry,
    site_code: entry.code,
    parent_site_code: entry.parent_code,
    created_at: "",
    updated_at: "",
  };
}
