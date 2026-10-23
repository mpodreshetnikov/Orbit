import type { MoneyCategory } from "@orbit-types/money";
import {
  canonicalCategoryOptions,
  categoryColumns,
  categoryFormOf,
  childCategoryForm,
  EMPTY_CATEGORY_FORM,
  parentCategoryOptions,
  type CategoryForm,
} from "@orbit-types/money-categories";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Alert } from "react-native";
import { Choice, Field, Input, Section } from "@/components/form";
import { Placeholder, Text } from "@/components/ui";
import { t } from "@/lib/i18n";
import { useMoneyCategories, useSaveCategory } from "@/lib/queries";
import { Sheet } from "@/screens/account-forms-screen";

/** A custom category, new (under `?parent=`) or being edited by `?id=` — the web category dialog. */
export default function MoneyCategoryFormScreen() {
  const { id, parent } = useLocalSearchParams<{ id?: string; parent?: string }>();
  const categories = useMoneyCategories();
  const all = categories.data ?? [];
  const editing = id ? all.find((one) => one.id === id) : undefined;
  const under = parent ? all.find((one) => one.id === parent) : undefined;
  if (categories.data && (!id || editing)) {
    return (
      <CategoryFormSheet
        all={all}
        editing={editing}
        initial={
          editing
            ? categoryFormOf(editing)
            : ((under && childCategoryForm(under)) ?? EMPTY_CATEGORY_FORM)
        }
      />
    );
  }
  const busy = categories.isPending;
  return (
    <>
      <Stack.Screen options={{ title: t("money.editCategory"), headerLargeTitle: false }} />
      <Placeholder busy={busy} message={busy ? undefined : t("common.noResults")} />
    </>
  );
}

function CategoryFormSheet({
  all,
  editing,
  initial,
}: {
  all: MoneyCategory[];
  editing?: MoneyCategory;
  initial: CategoryForm;
}) {
  const router = useRouter();
  const save = useSaveCategory();
  const [form, setForm] = useState(initial);
  const [problem, setProblem] = useState<string>();
  const set = (changes: Partial<CategoryForm>) =>
    setForm((current) => ({ ...current, ...changes }));
  const submit = () => {
    const saved = categoryColumns(all, form);
    if ("problem" in saved) {
      setProblem(
        t(
          saved.problem === "depth"
            ? "money.categoryDepthLimit"
            : "money.validationCategoryRequired",
        ),
      );
      return;
    }
    setProblem(undefined);
    save.mutate(
      { id: editing?.id, columns: saved.columns },
      {
        onSuccess: () => router.back(),
        onError: (error) => Alert.alert(t("common.error"), error.message),
      },
    );
  };
  const text = (key: "nameEn" | "nameRu" | "slug", label: string) => (
    <Field label={label}>
      <Input
        accessibilityLabel={label}
        value={form[key]}
        autoCapitalize={key === "slug" ? "none" : "sentences"}
        onChangeText={(value) => set({ [key]: value })}
      />
    </Field>
  );
  return (
    <Sheet
      title={t(editing ? "money.editCategory" : "money.addCategory")}
      busy={save.isPending}
      onSave={submit}
    >
      {problem ? <Text tone="destructive">{problem}</Text> : null}
      <Section title={t("money.categories")}>
        {text("nameEn", t("money.categoryNameEn"))}
        {text("nameRu", t("money.categoryNameRu"))}
        {text("slug", t("money.categorySlug"))}
        <Field label={t("money.categoryCanonicalBranch")}>
          <Choice<string | null>
            label={t("money.categoryCanonicalBranch")}
            value={form.canonicalId}
            placeholder={t("money.categorySelectCanonical")}
            options={canonicalCategoryOptions(all).map((one) => [one.id, one.name_en])}
            onPick={(canonicalId) => set({ canonicalId, parentId: null })}
          />
        </Field>
        <Field label={t("money.categoryParent")}>
          <Choice<string | null>
            label={t("money.categoryParent")}
            value={form.parentId}
            options={[
              [null, t("money.categoryRoot")],
              ...parentCategoryOptions(all, form.canonicalId, editing?.id).map(
                (one): [string, string] => [one.id, one.name_en],
              ),
            ]}
            onPick={(parentId) => set({ parentId })}
          />
        </Field>
      </Section>
    </Sheet>
  );
}
