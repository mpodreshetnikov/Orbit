import type { MedicalRecord, RecordType } from "@orbit-types/medical-record";
import { Stack, useRouter, type Href } from "expo-router";
import { ChevronRight, FileText } from "lucide-react-native";
import { useState } from "react";
import { FlatList, Pressable, RefreshControl, ScrollView, View } from "react-native";
import { Chip } from "@/components/form";
import { Button, Icon, Placeholder, Text } from "@/components/ui";
import { formatDay } from "@/features/measurements/format";
import { RECORD_TYPES, searchRecords } from "@/features/records/query";
import { t } from "@/lib/i18n";
import { usePerson, useRecords } from "@/lib/queries";
import { radius, space, usePalette } from "@/theme";

/** "Анализы", "Приём врача": a record type as the web list names it. */
export function recordTypeLabel(type: RecordType): string {
  return t(`records.types.${type}`);
}

/**
 * The person's documents — the web records list, without its upload: documents arrive through
 * Claude and the web app. Searched from the bar by title, notes, summary and keywords, narrowed by
 * type from the chips; each row opens the document.
 */
export default function RecordsScreen() {
  const palette = usePalette();
  const person = usePerson();
  const records = useRecords(person.data?.id);
  const [query, setQuery] = useState("");
  const [type, setType] = useState<RecordType | "all">("all");
  const visible = searchRecords(records.data ?? [], query, type);

  const header = (
    <Stack.Screen
      options={{
        title: t("health.documents"),
        headerSearchBarOptions: {
          placeholder: t("records.search"),
          hideWhenScrolling: false,
          onChangeText: (event) => setQuery(event.nativeEvent.text),
          onCancelButtonPress: () => setQuery(""),
        },
      }}
    />
  );

  const failed = person.error ?? records.error;
  if (failed) {
    return (
      <>
        {header}
        <Placeholder
          message={failed.message}
          action={
            <Button
              variant="outline"
              label={t("common.retry")}
              onPress={() => void (person.error ? person.refetch() : records.refetch())}
            />
          }
        />
      </>
    );
  }

  const types: (RecordType | "all")[] = ["all", ...RECORD_TYPES];
  const chips = (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: space.sm, paddingBottom: space.xs }}
    >
      {types.map((one) => (
        <Chip
          key={one}
          label={one === "all" ? t("records.allTypes") : recordTypeLabel(one)}
          selected={type === one}
          onPress={() => setType(one)}
        />
      ))}
    </ScrollView>
  );

  return (
    <>
      {header}
      <FlatList
        data={visible}
        keyExtractor={(record) => record.id}
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ padding: space.lg, gap: space.sm, paddingBottom: space.xl * 2 }}
        ListHeaderComponent={chips}
        ListEmptyComponent={
          records.isPending ? (
            <Placeholder busy />
          ) : (records.data?.length ?? 0) === 0 ? (
            <Placeholder message={t("health.noDocuments")} />
          ) : (
            <Placeholder message={t("common.noResults")} />
          )
        }
        refreshControl={
          <RefreshControl
            refreshing={records.isRefetching}
            onRefresh={() => void records.refetch()}
            tintColor={palette.mutedForeground}
          />
        }
        renderItem={({ item }) => <RecordRow record={item} />}
      />
    </>
  );
}

/** A document in a list: its title, type and date; it opens the document. */
export function RecordRow({ record }: { record: MedicalRecord }) {
  const palette = usePalette();
  const router = useRouter();
  return (
    <Pressable
      accessibilityRole="link"
      onPress={() => router.push(`/health/records/${record.id}` as Href)}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        padding: space.md,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: palette.border,
        backgroundColor: pressed ? palette.mutedHalf : palette.card,
      })}
    >
      <Icon icon={FileText} size={20} tone="primary" />
      <View style={{ flex: 1, gap: 2 }}>
        <Text weight="medium" numberOfLines={2}>
          {record.title}
        </Text>
        <Text size="xs" tone="mutedForeground" numberOfLines={1}>
          {recordTypeLabel(record.record_type)} ·{" "}
          {record.record_date ? formatDay(record.record_date) : t("records.noDate")}
        </Text>
      </View>
      <Icon icon={ChevronRight} size={16} />
    </Pressable>
  );
}
