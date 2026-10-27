import { useRouter, type Href } from "expo-router";
import { useState } from "react";
import { Alert, KeyboardAvoidingView, View } from "react-native";
import { Field, Input } from "@/components/form";
import { Button, Text } from "@/components/ui";
import { t } from "@/lib/i18n";
import { discoverInstance, type Instance } from "@/lib/instance";
import { InstanceConfigError } from "@/lib/instance-config";
import { useInstance } from "@/lib/instance-context";
import { space, usePalette } from "@/theme";

/** "orbit.example.com" for "https://orbit.example.com": how a person writes their server. */
function hostOf(address: string): string {
  return new URL(address).host;
}

/**
 * Which Orbit server this phone talks to — asked on the first start of a build that names none, and
 * reached later from the settings or the sign-in screen to change it. The person types the address
 * they open in a browser; the app reads what it needs from that server and keeps nothing until the
 * server answers as an Orbit instance. Changing to another server signs out of this one first.
 */
export default function ServerScreen() {
  const palette = usePalette();
  const router = useRouter();
  const { instance, switchTo } = useInstance();
  const [address, setAddress] = useState(instance ? hostOf(instance.address) : "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function adopt(next: Instance) {
    await switchTo(next);
    router.replace("/sign-in" as Href);
  }

  async function connect() {
    setBusy(true);
    setError(null);
    let next: Instance;
    try {
      next = await discoverInstance(address);
    } catch (problem) {
      setError(
        problem instanceof InstanceConfigError && problem.problem
          ? t(`instance.errors.${problem.problem}`)
          : t("instance.errors.unreachable"),
      );
      setBusy(false);
      return;
    }
    if (!instance) {
      await adopt(next);
      return;
    }
    if (next.address === instance.address) {
      router.back();
      return;
    }
    setBusy(false);
    Alert.alert(
      t("instance.confirmTitle"),
      t("instance.confirmMessage", { address: hostOf(instance.address) }),
      [
        { text: t("common.cancel"), style: "cancel" },
        { text: t("instance.change"), style: "destructive", onPress: () => void adopt(next) },
      ],
    );
  }

  return (
    <KeyboardAvoidingView
      behavior="padding"
      style={{ flex: 1, backgroundColor: palette.background }}
    >
      <View style={{ flex: 1, justifyContent: "center", padding: space.xl, gap: space.xl }}>
        <View style={{ gap: space.xs }}>
          <Text size="xl" weight="semibold">
            {t("instance.title")}
          </Text>
          <Text size="sm" tone="mutedForeground">
            {t("instance.description")}
          </Text>
        </View>
        <Field label={t("instance.address")} error={error ?? undefined}>
          <Input
            accessibilityLabel={t("instance.address")}
            testID="server-address"
            placeholder="orbit.example.com"
            value={address}
            onChangeText={setAddress}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            textContentType="URL"
            returnKeyType="go"
            onSubmitEditing={() => void connect()}
          />
        </Field>
        <Button label={t("instance.connect")} busy={busy} onPress={() => void connect()} />
        {instance ? (
          <Button variant="ghost" label={t("common.cancel")} onPress={() => router.back()} />
        ) : null}
      </View>
    </KeyboardAvoidingView>
  );
}
