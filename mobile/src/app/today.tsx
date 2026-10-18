import { Redirect, Stack } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSession } from "@/lib/session";
import { msUntilNextLocalDay } from "@/features/doses/day";
import { countDue, presentDoses, type DoseCard } from "@/features/doses/present";
import { fetchDosesForDay, resolveOwnPerson } from "@/features/doses/query";
import { theme } from "@/theme";

type Loaded = { personName: string; cards: DoseCard[] };

/**
 * Today's doses.
 *
 * The one screen `M1` of `T-261018-l19` ships, and the reason it is this one rather than a list of
 * medications: the server already materialises dose events, so a day's plan needs no schedule
 * parsing on the client, and "what do I take now" is the question a phone is actually asked.
 *
 * Marking a dose taken arrives in `M2`; until then this reads.
 */
export default function Today() {
  const { session, signOut } = useSession();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const person = await resolveOwnPerson(session?.user.id);
      const events = await fetchDosesForDay(person.id);
      setLoaded({ personName: person.name, cards: presentDoses(events) });
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [session?.user.id]);

  useEffect(() => {
    void load();
  }, [load]);

  // The list holds one local day, so it has to stop holding it when that day ends. Two ways a day
  // can end under a mounted screen, and both happen on a phone: it is backgrounded overnight and
  // comes back the next morning, or it is simply left open past midnight. Without these the heading
  // says today over yesterday's doses until somebody pulls to refresh.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void load();
      }
    });
    return () => subscription.remove();
  }, [load]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), msUntilNextLocalDay(new Date()));
    return () => clearTimeout(timer);
    // Re-armed on every load, so the next timer is measured from the day the data is actually for.
  }, [load, loaded]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  if (!session) {
    return <Redirect href="/sign-in" />;
  }

  if (error !== null) {
    return (
      <View style={styles.centered}>
        <Text style={styles.error}>{error}</Text>
        <Pressable accessibilityRole="button" onPress={() => void load()}>
          <Text style={styles.link}>Повторить</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => void signOut()}>
          <Text style={styles.linkMuted}>Выйти</Text>
        </Pressable>
      </View>
    );
  }

  if (loaded === null) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={theme.color.accent} />
      </View>
    );
  }

  const due = countDue(loaded.cards);

  return (
    <>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Выйти из аккаунта"
              onPress={() => void signOut()}
              hitSlop={theme.space.sm}
            >
              <Text style={styles.headerAction}>Выйти</Text>
            </Pressable>
          ),
        }}
      />
      <FlatList
        data={loaded.cards}
        keyExtractor={(card) => card.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.headerPerson}>{loaded.personName}</Text>
            <Text style={styles.headerDue}>
              {due === 0 ? "на сегодня всё" : `осталось приёмов: ${due}`}
            </Text>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.centered}>
            <Text style={styles.empty}>На сегодня приёмов не запланировано</Text>
          </View>
        }
        renderItem={({ item }) => <DoseRow card={item} />}
      />
    </>
  );
}

function DoseRow({ card }: { card: DoseCard }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.time, card.state !== "due" && styles.timeInactive]}>{card.time}</Text>
      <View style={styles.rowBody}>
        <Text style={[styles.name, card.state !== "due" && styles.nameInactive]}>{card.name}</Text>
        {card.amount === null ? null : <Text style={styles.amount}>{card.amount}</Text>}
      </View>
      <DoseStateMark state={card.state} />
    </View>
  );
}

const STATE_MARK: Record<DoseCard["state"], { label: string; color: string } | null> = {
  due: null,
  taken: { label: "принято", color: theme.color.done },
  skipped: { label: "пропущено", color: theme.color.textMuted },
  missed: { label: "не принято", color: theme.color.danger },
};

function DoseStateMark({ state }: { state: DoseCard["state"] }) {
  const mark = STATE_MARK[state];
  if (mark === null) {
    return null;
  }
  return <Text style={[styles.mark, { color: mark.color }]}>{mark.label}</Text>;
}

const styles = StyleSheet.create({
  list: { paddingBottom: theme.space.lg },
  header: { paddingHorizontal: theme.space.md, paddingBottom: theme.space.md },
  headerPerson: { fontSize: 28, fontWeight: "700", color: theme.color.text },
  headerDue: { fontSize: 15, color: theme.color.textMuted, marginTop: theme.space.xs },
  headerAction: { fontSize: 17, color: theme.color.accent },
  centered: { flexGrow: 1, alignItems: "center", justifyContent: "center", gap: theme.space.md },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.md,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.md,
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius,
    marginHorizontal: theme.space.md,
    marginBottom: theme.space.sm,
  },
  rowBody: { flex: 1 },
  time: { fontSize: 17, fontVariant: ["tabular-nums"], color: theme.color.text, fontWeight: "600" },
  timeInactive: { color: theme.color.textMuted, fontWeight: "400" },
  name: { fontSize: 17, color: theme.color.text },
  nameInactive: { color: theme.color.textMuted },
  amount: { fontSize: 15, color: theme.color.textMuted, marginTop: 2 },
  mark: { fontSize: 13 },
  error: {
    color: theme.color.danger,
    fontSize: 15,
    textAlign: "center",
    paddingHorizontal: theme.space.lg,
  },
  link: { color: theme.color.accent, fontSize: 17 },
  linkMuted: { color: theme.color.textMuted, fontSize: 15 },
  empty: { color: theme.color.textMuted, fontSize: 17, textAlign: "center" },
});
