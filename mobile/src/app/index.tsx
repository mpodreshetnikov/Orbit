import { Redirect } from "expo-router";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useSession } from "@/lib/session";
import { theme } from "@/theme";

/**
 * Where a cold start lands.
 *
 * While the stored session is still being read the answer is "not yet" rather than "signed out", so
 * this holds a spinner instead of redirecting. Routing on the unknown state is what makes an app
 * flash its login screen at somebody who is already signed in.
 */
export default function Index() {
  const { session } = useSession();

  if (session === undefined) {
    return (
      <View style={styles.container}>
        <ActivityIndicator color={theme.color.accent} />
      </View>
    );
  }

  return <Redirect href={session ? "/today" : "/sign-in"} />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.color.background,
  },
});
