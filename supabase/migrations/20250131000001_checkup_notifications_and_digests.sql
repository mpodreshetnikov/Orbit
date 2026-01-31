-- ============================================================================
-- Checkup notification settings, plan mark, push subscriptions, notification digests
-- ============================================================================

-- ----------------------------------------------------------------------------
-- checkup_items: add reminder_days_before and planned_on
-- ----------------------------------------------------------------------------
ALTER TABLE public.checkup_items
  ADD COLUMN IF NOT EXISTS reminder_days_before integer[] NOT NULL DEFAULT ARRAY[7],
  ADD COLUMN IF NOT EXISTS planned_on date;

COMMENT ON COLUMN public.checkup_items.reminder_days_before IS 'Days before next_due_at to send reminder (e.g. 7, 3, 1)';
COMMENT ON COLUMN public.checkup_items.planned_on IS 'User-planned date for this checkup; no "X days before" reminders before this day';

-- ----------------------------------------------------------------------------
-- user_preferences (one row per auth user: notification time and timezone)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_preferences (
  auth_user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  checkup_notification_time time NOT NULL DEFAULT '09:00',
  checkup_notification_timezone text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER update_user_preferences_updated_at
  BEFORE UPDATE ON public.user_preferences
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own user_preferences"
  ON public.user_preferences FOR SELECT TO authenticated
  USING (auth_user_id = auth.uid());

CREATE POLICY "Users can insert own user_preferences"
  ON public.user_preferences FOR INSERT TO authenticated
  WITH CHECK (auth_user_id = auth.uid());

CREATE POLICY "Users can update own user_preferences"
  ON public.user_preferences FOR UPDATE TO authenticated
  USING (auth_user_id = auth.uid())
  WITH CHECK (auth_user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- push_subscriptions (one row per device for Web Push)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint text NOT NULL,
  p256dh text NOT NULL,
  auth text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (endpoint)
);

CREATE INDEX idx_push_subscriptions_auth_user_id ON public.push_subscriptions(auth_user_id);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own push_subscriptions"
  ON public.push_subscriptions FOR SELECT TO authenticated
  USING (auth_user_id = auth.uid());

CREATE POLICY "Users can insert own push_subscriptions"
  ON public.push_subscriptions FOR INSERT TO authenticated
  WITH CHECK (auth_user_id = auth.uid());

CREATE POLICY "Users can delete own push_subscriptions"
  ON public.push_subscriptions FOR DELETE TO authenticated
  USING (auth_user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- notification_digests (scheduled notifications, sent_at set when device reports shown)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notification_digests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type text NOT NULL,
  scheduled_at timestamptz NOT NULL,
  payload_json jsonb NOT NULL,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_notification_digests_auth_user_type_scheduled
  ON public.notification_digests(auth_user_id, type, scheduled_at);
CREATE INDEX idx_notification_digests_scheduled_sent
  ON public.notification_digests(scheduled_at, sent_at);
CREATE INDEX idx_notification_digests_sent_at
  ON public.notification_digests(sent_at) WHERE sent_at IS NULL;

ALTER TABLE public.notification_digests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own notification_digests"
  ON public.notification_digests FOR SELECT TO authenticated
  USING (auth_user_id = auth.uid());

CREATE POLICY "Users can update own notification_digests (for mark-shown)"
  ON public.notification_digests FOR UPDATE TO authenticated
  USING (auth_user_id = auth.uid())
  WITH CHECK (auth_user_id = auth.uid());
