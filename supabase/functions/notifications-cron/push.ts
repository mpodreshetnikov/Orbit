import type { NotificationItem } from "./digest.ts";

export interface MedicationPushGroup {
  id: string;
  ids: string[];
  type: "medication";
  title: string;
  medItems: Array<{
    medicationName: string | null;
    amount: string | null;
    unit: string;
    body: string;
  }>;
  url: string;
  scheduledAt: string;
  dose_event_ids: string[];
  person_id: string | null;
  person_name: string | null;
  title_prefix: string | null;
}

export function aggregateMedicationNotifications(
  notifications: NotificationItem[],
): MedicationPushGroup[] {
  const medicationItems = notifications.filter(
    (item) => item.type === "medication" || item.type === "medication_snoozed",
  );
  const groups = new Map<
    string,
    {
      personId: string | null;
      personName: string | null;
      titlePrefix: string | null;
      ids: Set<string>;
      medItems: MedicationPushGroup["medItems"];
      scheduledAt: string;
      doseEventIds: string[];
    }
  >();

  for (const notification of medicationItems) {
    const key = notification.personId ?? "unknown";
    const medItem = {
      medicationName: notification.medicationName ?? null,
      amount: notification.amount ?? null,
      unit: notification.unit ?? "pill",
      body:
        notification.body ||
        (notification.medicationName && notification.timeStr
          ? `${notification.amount ?? "1"} ${notification.unit ?? "pill"} · ${notification.timeStr}`
          : ""),
    };

    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        personId: notification.personId ?? null,
        personName: notification.personName ?? null,
        titlePrefix: notification.titlePrefix ?? null,
        ids: new Set([notification.id]),
        medItems: [medItem],
        scheduledAt: notification.scheduledAt,
        doseEventIds: notification.dose_event_id ? [notification.dose_event_id] : [],
      });
      continue;
    }

    existing.ids.add(notification.id);
    existing.medItems.push(medItem);
    if (notification.scheduledAt < existing.scheduledAt) {
      existing.scheduledAt = notification.scheduledAt;
    }
    if (notification.dose_event_id) {
      existing.doseEventIds.push(notification.dose_event_id);
    }
  }

  return Array.from(groups.values()).map((group) => ({
    id: Array.from(group.ids)[0],
    ids: Array.from(group.ids),
    type: "medication",
    title: "Medications",
    medItems: group.medItems,
    url: "/health/medications",
    scheduledAt: group.scheduledAt,
    dose_event_ids: group.doseEventIds,
    person_id: group.personId,
    person_name: group.personName,
    title_prefix: group.titlePrefix,
  }));
}

export function buildPushPayload(notifications: NotificationItem[]): unknown[] {
  const aggregatedMeds = aggregateMedicationNotifications(notifications);
  const nonMedication = notifications
    .filter((item) => item.type !== "medication" && item.type !== "medication_snoozed")
    .map((item) => ({
      id: item.id,
      type: item.type,
      title: item.title,
      body: item.body,
      url: item.url,
      scheduledAt: item.scheduledAt,
      person_id: item.personId ?? null,
      person_name: item.personName ?? null,
      title_prefix: item.titlePrefix ?? null,
      ...(item.dose_event_id != null
        ? { dose_event_id: item.dose_event_id, dose_event_ids: [item.dose_event_id] }
        : {}),
    }));

  return [...aggregatedMeds, ...nonMedication];
}
