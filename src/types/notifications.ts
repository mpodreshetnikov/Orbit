// ============================================================================
// User preferences (notification time, timezone)
// ============================================================================

export interface UserPreferences {
  auth_user_id: string;
  checkup_notification_time: string; // "HH:mm" or time from DB
  checkup_notification_timezone: string | null; // IANA e.g. "Europe/Moscow"
  created_at: string;
  updated_at: string;
}

export interface UpdateUserPreferencesInput {
  checkup_notification_time?: string;
  checkup_notification_timezone?: string | null;
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
}

export interface NotificationsResponse {
  notifications: NotificationForDevice[];
}
