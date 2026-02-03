// ============================================================================
// User preferences (notification time, timezone)
// ============================================================================

export interface UserPreferences {
  auth_user_id: string;
  checkup_notification_time: string; // "HH:mm" or time from DB
  checkup_notification_timezone: string | null; // IANA e.g. "Europe/Moscow"
  /** Notify for overdue medication doses every this many minutes within the same day. Default 30. */
  overdue_reminder_interval_minutes: number;
  created_at: string;
  updated_at: string;
}

export interface UpdateUserPreferencesInput {
  checkup_notification_time?: string;
  checkup_notification_timezone?: string | null;
  overdue_reminder_interval_minutes?: number | null;
}

// ============================================================================
// Push subscription (Web Push)
// ============================================================================

export interface PushSubscriptionRow {
  id: string;
  auth_user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  created_at: string;
}

export interface PushSubscriptionInput {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

// ============================================================================
// Notification digest (backend) and payload (push/pull)
// ============================================================================

export interface NotificationDigest {
  id: string;
  auth_user_id: string;
  type: string; // 'checkup' | 'medication' | ...
  scheduled_at: string; // ISO
  payload_json: NotificationPayload;
  sent_at: string | null;
  created_at: string;
}

export interface NotificationPayload {
  title: string;
  body: string;
  url: string;
  person_id?: string | null;
  person_name?: string | null;
  title_prefix?: string | null;
  tag?: string | null;
  [key: string]: unknown;
}

/** Single notification as sent to device (push or pull response) */
export interface NotificationForDevice {
  id: string;
  type: string;
  title: string;
  body: string;
  url: string;
  scheduledAt: string; // ISO
  person_id?: string | null;
  person_name?: string | null;
  title_prefix?: string | null;
  tag?: string | null;
  /** For medication type: dose event id(s) to confirm/skip from notification actions */
  dose_event_id?: string;
  dose_event_ids?: string[];
}

export interface NotificationsResponse {
  notifications: NotificationForDevice[];
}

// ============================================================================
// Notification routing (per-person subscriptions)
// ============================================================================

export interface NotificationRoutingRow {
  id: string;
  recipient_user_id: string;
  person_id: string;
  enabled: boolean;
  custom_prefix: string | null;
  created_at: string;
  updated_at: string;
}

export interface NotificationRoutingUpsertInput {
  person_id: string;
  enabled: boolean;
  custom_prefix?: string | null;
}
