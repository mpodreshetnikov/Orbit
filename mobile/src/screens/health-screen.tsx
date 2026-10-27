import { Stack, useRouter, type Href } from "expo-router";
import {
  BookOpen,
  CalendarCheck,
  ChevronRight,
  FlaskConical,
  HeartPulse,
  MapPin,
  Search,
  Ruler,
  Stethoscope,
  type LucideIcon,
} from "lucide-react-native";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import { Button, Card, Icon, Text } from "@/components/ui";
import { t } from "@/lib/i18n";
import { usePerson, useRecords } from "@/lib/queries";
import { space, usePalette } from "@/theme";
import { RecordRow } from "./records-screen";

/** How many of the latest documents the tab shows before "Все документы". */
const LATEST = 3;

/** The web app's health sections, each a row into its own screen. */
const SECTIONS: { title: string; description?: string; icon: LucideIcon; href: string }[] = [
  {
    title: "conditions.title",
    description: "conditions.description",
    icon: HeartPulse,
    href: "/health/conditions",
  },
  {
    title: "checkups.navTitle",
    description: "checkups.description",
    icon: CalendarCheck,
    href: "/health/checkups",
  },
  {
    title: "observationHistory.navTitle",
    description: "observationHistory.description",
    icon: FlaskConical,
    href: "/health/observations",
  },
  {
    title: "findings.navTitle",
    icon: Search,
    href: "/health/findings",
  },
  {
    title: "measurements.title",
    description: "measurements.description",
    icon: Ruler,
    href: "/health/measurements",
  },
  {
    title: "catalogs.measurements",
    description: "catalogs.measurementsDescription",
    icon: BookOpen,
    href: "/health/catalogs/measurements",
  },
  {
    title: "catalogs.findingTypes",
    description: "catalogs.findingTypesDescription",
    icon: Stethoscope,
    href: "/health/catalogs/finding-types",
  },
  {
    title: "catalogs.bodySites",
    description: "catalogs.bodySitesDescription",
    icon: MapPin,
    href: "/health/catalogs/body-sites",
  },
];

/** "Здоровье": the latest documents on top, then the web health menu as a grouped list. */
export default function HealthScreen() {
  const palette = usePalette();
  const router = useRouter();
  return (
    <>
      <Stack.Screen options={{ title: t("nav.health") }} />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: space.lg, gap: space.lg }}
      >
        <Documents />
        <Card style={{ paddingVertical: space.xs }}>
          {SECTIONS.map((section, index) => (
            <Pressable
              key={section.href}
              accessibilityRole="link"
              accessibilityLabel={t(section.title)}
              onPress={() => router.push(section.href as Href)}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: space.md,
                paddingHorizontal: space.lg,
                paddingVertical: space.md,
                borderTopWidth: index === 0 ? 0 : 1,
                borderColor: palette.border,
                backgroundColor: pressed ? palette.mutedHalf : "transparent",
              })}
            >
              <Icon icon={section.icon} size={20} tone="foreground" />
              <View style={{ flex: 1, gap: 2 }}>
                <Text weight="medium">{t(section.title)}</Text>
                {section.description ? (
                  <Text size="xs" tone="mutedForeground">
                    {t(section.description)}
                  </Text>
                ) : null}
              </View>
              <Icon icon={ChevronRight} />
            </Pressable>
          ))}
        </Card>
      </ScrollView>
    </>
  );
}

/** The person's latest documents, each opening the document, and the way to all of them. */
function Documents() {
  const router = useRouter();
  const person = usePerson();
  const records = useRecords(person.data?.id);
  const failed = person.error ?? records.error;
  const latest = (records.data ?? []).slice(0, LATEST);
  return (
    <View style={{ gap: space.sm }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text size="lg" weight="semibold">
          {t("health.documents")}
        </Text>
        <Button
          compact
          variant="ghost"
          label={t("health.allDocuments")}
          onPress={() => router.push("/health/records" as Href)}
        />
      </View>
      {failed ? (
        <View style={{ gap: space.sm }}>
          <Text size="sm" tone="destructive">
            {failed.message}
          </Text>
          <Button
            variant="outline"
            compact
            label={t("common.retry")}
            onPress={() => void (person.error ? person.refetch() : records.refetch())}
          />
        </View>
      ) : records.isPending ? (
        <ActivityIndicator />
      ) : latest.length === 0 ? (
        <Text size="sm" tone="mutedForeground">
          {t("health.noDocuments")}
        </Text>
      ) : (
        latest.map((record) => <RecordRow key={record.id} record={record} />)
      )}
    </View>
  );
}
