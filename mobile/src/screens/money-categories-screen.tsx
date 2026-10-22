import type { MoneyCategory } from "@orbit-types/money";
import {
  buildMoneyCategoryTree,
  categoryHasChildren,
  childCategoryForm,
  type MoneyCategoryTreeNode,
} from "@orbit-types/money-categories";
import { Stack, useRouter, type Href } from "expo-router";
import { Plus } from "lucide-react-native";
import { ActionSheetIOS, Alert, FlatList, Pressable, RefreshControl, View } from "react-native";
import { Badge, Button, Icon, Placeholder, Text } from "@/components/ui";
import { t } from "@/lib/i18n";
import { useMoneyCategories, useSaveCategory } from "@/lib/queries";
import { space, usePalette } from "@/theme";

/** How long the system sheet takes to slide away before an alert may be shown. */
const SHEET_DISMISS_MS = 400;

/** The tree as rows, each with how far it is indented. */
export function categoryRows(
  nodes: MoneyCategoryTreeNode[],
  level = 0,
): { category: MoneyCategory; level: number }[] {
  return nodes.flatMap((node) => [
    { category: node, level },
    ...categoryRows(node.children, level + 1),
  ]);
}

/**
 * "Категории" — the web categories tree: canonical branches with the custom categories under them.
 * A canonical row only takes a child; a custom one also edits or deletes, a delete asked first and
 * refused while it has children.
 */
export default function MoneyCategoriesScreen() {
  const palette = usePalette();
  const router = useRouter();
  const categories = useMoneyCategories();
  const save = useSaveCategory();
  const all = categories.data ?? [];

  const open = (query = "") => router.push(`/money/categories/form${query}` as Href);
  const later = (show: () => void) => setTimeout(show, SHEET_DISMISS_MS);
  const remove = (category: MoneyCategory) =>
    later(() =>
      categoryHasChildren(all, category.id)
        ? Alert.alert(t("common.error"), t("money.cannotDeleteCategory"))
        : Alert.alert(t("common.delete"), t("money.deleteCategoryConfirm"), [
            { text: t("common.cancel"), style: "cancel" },
            {
              text: t("common.delete"),
              style: "destructive",
              onPress: () =>
                save.mutate(
                  { id: category.id, columns: null },
                  { onError: (error) => Alert.alert(t("common.error"), error.message) },
                ),
            },
          ]),
    );
  const actions = (category: MoneyCategory) => {
    const addChild = () =>
      childCategoryForm(category)
        ? open(`?parent=${category.id}`)
        : later(() => Alert.alert(t("common.error"), t("money.categoryDepthLimit")));
    const choices: [string, () => void][] =
      category.category_kind === "canonical"
        ? [[t("money.addCategory"), addChild]]
        : [
            [t("money.addCategory"), addChild],
            [t("common.edit"), () => open(`?id=${category.id}`)],
            [t("common.delete"), () => remove(category)],
          ];
    const options = [...choices.map(([label]) => label), t("common.cancel")];
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: category.name_en,
        options,
        destructiveButtonIndex: category.category_kind === "canonical" ? undefined : 2,
        cancelButtonIndex: options.length - 1,
      },
      (index) => choices[index]?.[1](),
    );
  };

  const header = (
    <Stack.Screen
      options={{
        title: t("money.categories"),
        headerRight: () => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("money.addCategory")}
            hitSlop={space.sm}
            onPress={() => open()}
          >
            <Icon icon={Plus} size={24} tone="foreground" />
          </Pressable>
        ),
      }}
    />
  );
  if (!all.length) {
    const busy = categories.isPending;
    return (
      <>
        {header}
        <Placeholder
          busy={busy}
          message={busy ? undefined : (categories.error?.message ?? t("money.noCategoriesHint"))}
          action={
            busy ? undefined : <Button label={t("money.addCategory")} onPress={() => open()} />
          }
        />
      </>
    );
  }

  return (
    <>
      {header}
      <FlatList
        contentInsetAdjustmentBehavior="automatic"
        data={categoryRows(buildMoneyCategoryTree(all))}
        keyExtractor={({ category }) => category.id}
        contentContainerStyle={{ paddingVertical: space.sm, paddingBottom: space.xl * 2 }}
        refreshControl={
          <RefreshControl
            refreshing={categories.isRefetching}
            onRefresh={() => void categories.refetch()}
            tintColor={palette.mutedForeground}
          />
        }
        renderItem={({ item: { category, level } }) => (
          <Pressable
            accessibilityRole="button"
            onPress={() => actions(category)}
            style={({ pressed }) => ({
              paddingVertical: space.sm,
              paddingRight: space.lg,
              paddingLeft: space.lg + level * space.lg,
              borderBottomWidth: 1,
              borderBottomColor: palette.border,
              backgroundColor: pressed ? palette.mutedHalf : undefined,
            })}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
              <Text weight="medium" style={{ flexShrink: 1 }}>
                {category.name_en}
              </Text>
              {category.category_kind === "canonical" ? (
                <Badge label={t("money.categoryCanonical")} />
              ) : null}
            </View>
            <Text size="xs" tone="mutedForeground">
              {`${category.name_ru} · ${category.slug}`}
            </Text>
          </Pressable>
        )}
      />
    </>
  );
}
