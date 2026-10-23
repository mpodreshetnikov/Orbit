import { Stack, useRouter, type Href } from "expo-router";
import { BookOpen, ChevronRight, Ruler, type LucideIcon } from "lucide-react-native";
import { Pressable, ScrollView, View } from "react-native";
import { Card, Icon, Text } from "@/components/ui";
import { t } from "@/lib/i18n";
import { space, usePalette } from "@/theme";

/** The web app's health sections, each a row into its own screen. */
const SECTIONS: { title: string; description: string; icon: LucideIcon; href: string }[] = [
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
];

/** "Здоровье": the web health menu as a grouped list. */
export default function HealthScreen() {
  const palette = usePalette();
  const router = useRouter();
  return (
    <>
      <Stack.Screen options={{ title: t("nav.health") }} />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: space.lg }}
      >
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
                <Text size="xs" tone="mutedForeground">
                  {t(section.description)}
                </Text>
              </View>
              <Icon icon={ChevronRight} />
            </Pressable>
          ))}
        </Card>
      </ScrollView>
    </>
  );
}
