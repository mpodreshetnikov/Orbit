export interface NotificationDigestRow {
  id: string;
  type: string;
  scheduled_at: string;
  payload_json: Record<string, unknown> | null;
  person_id: string | null;
}

export interface RoutedPersonRow {
  person_id: string;
  person_name: string;
  custom_prefix: string | null;
  person_owner_user_id: string | null;
}

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  url: string;
  scheduledAt: string;
  personId?: string | null;
  personName?: string | null;
  titlePrefix?: string | null;
  dose_event_id?: string | null;
  isOverdueReminder?: boolean;
  medicationName?: string | null;
  amount?: string | null;
  unit?: string | null;
  timeStr?: string | null;
}

interface MedicationDosePayload {
  dose_event_id?: string;
  medication_name?: string;
  amount?: string;
  unit?: string;
  time_str?: string;
  body?: string;
  is_overdue_reminder?: boolean;
}

interface DigestPayloadJson {
  title?: string;
  body?: string;
  url?: string;
  person_id?: string;
  person_name?: string;
  title_prefix?: string;
  dose_event_id?: string;
  medication_name?: string;
  amount?: string;
  unit?: string;
  time_str?: string;
  is_overdue_reminder?: boolean;
  doses?: MedicationDosePayload[];
}

export function filterUnsentRowsByAllowedPersons(
  rows: NotificationDigestRow[],
  routedPersons: RoutedPersonRow[],
): NotificationDigestRow[] {
  const allowedPersonIds = new Set(routedPersons.map((item) => item.person_id));
  return rows.filter((row) => {
    if (!row.person_id) return true;
    return allowedPersonIds.has(row.person_id);
  });
}

export function mapDigestRowsToNotifications(
  rows: NotificationDigestRow[],
  routedPersons: RoutedPersonRow[],
  authUserId: string,
  inWindow: boolean,
): NotificationItem[] {
  const personMetaById = new Map(routedPersons.map((item) => [item.person_id, item] as const));
  const notifications: NotificationItem[] = [];

  for (const row of rows) {
    const payload = (row.payload_json ?? {}) as DigestPayloadJson;
    const personId = row.person_id ?? payload.person_id ?? null;
    const personMeta = personId ? personMetaById.get(personId) : null;
    const isOwnPerson = personId != null && personMeta?.person_owner_user_id === authUserId;
    const personName = payload.person_name ?? personMeta?.person_name ?? null;
    const hasExplicitTitlePrefix = Object.prototype.hasOwnProperty.call(payload, "title_prefix");
    const rawTitlePrefix = hasExplicitTitlePrefix
      ? (payload.title_prefix ?? null)
      : (personMeta?.custom_prefix ?? personName ?? null);
    const titlePrefix = isOwnPerson ? null : rawTitlePrefix;

    if (row.type === "medication" || row.type === "medication_snoozed") {
      const doses = Array.isArray(payload.doses) ? payload.doses : null;
      if (doses && doses.length > 0) {
        for (const dose of doses) {
          notifications.push({
            id: row.id,
            type: row.type,
            title: payload.title ?? "",
            body: dose.body ?? payload.body ?? "",
            url: payload.url ?? "/",
            scheduledAt: row.scheduled_at,
            personId,
            personName,
            titlePrefix,
            dose_event_id: dose.dose_event_id ?? null,
            isOverdueReminder: dose.is_overdue_reminder === true,
            medicationName: dose.medication_name ?? null,
            amount: dose.amount ?? null,
            unit: dose.unit ?? null,
            timeStr: dose.time_str ?? null,
          });
        }
      } else {
        notifications.push({
          id: row.id,
          type: row.type,
          title: payload.title ?? "",
          body: payload.body ?? "",
          url: payload.url ?? "/",
          scheduledAt: row.scheduled_at,
          personId,
          personName,
          titlePrefix,
          dose_event_id: payload.dose_event_id ?? null,
          isOverdueReminder: payload.is_overdue_reminder === true,
          medicationName: payload.medication_name ?? null,
          amount: payload.amount ?? null,
          unit: payload.unit ?? null,
          timeStr: payload.time_str ?? null,
        });
      }
      continue;
    }

    // Refill digests are delivered only during the reminder window.
    if (row.type === "medication_refill" && !inWindow) {
      continue;
    }

    notifications.push({
      id: row.id,
      type: row.type,
      title: payload.title ?? "",
      body: payload.body ?? "",
      url: payload.url ?? "/",
      scheduledAt: row.scheduled_at,
      personId,
      personName,
      titlePrefix,
      dose_event_id: payload.dose_event_id ?? null,
    });
  }

  return notifications;
}
