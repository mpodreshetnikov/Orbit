import { NativeTabs } from "expo-router/unstable-native-tabs";
import { Redirect } from "expo-router";
import { t } from "@/lib/i18n";
import { useSession } from "@/lib/session";

/**
 * The system tab bar — `UITabBar`, not a JavaScript imitation of one: Liquid Glass on iOS 26, the
 * system's own selection and its tap-to-scroll-to-top. Each tab holds a native stack, which is what
 * gives it a header and lets it push.
 *
 * `unstable-native-tabs` is the SDK 57 name of what SDK 58 calls `native-tabs`.
 */
export default function TabsLayout() {
  const { session } = useSession();
  if (session === null) {
    return <Redirect href="/sign-in" />;
  }

  return (
    <NativeTabs>
      <NativeTabs.Trigger name="today">
        <NativeTabs.Trigger.Label>{t("medications.dateToday")}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: "checklist", selected: "checklist" }}
          md="checklist"
        />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="medications">
        <NativeTabs.Trigger.Label>{t("medications.navTitle")}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: "pills", selected: "pills.fill" }}
          md="medication"
        />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="health">
        <NativeTabs.Trigger.Label>{t("nav.health")}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: "heart", selected: "heart.fill" }} md="favorite" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
