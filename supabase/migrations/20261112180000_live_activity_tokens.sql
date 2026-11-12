-- Live Activity push-to-start tokens (T-0023 / ORB-38 F/G).
-- APNs environment is required: development-signed builds produce sandbox tokens;
-- TestFlight / App Store builds produce production tokens. Wrong host → BadDeviceToken.

CREATE TABLE IF NOT EXISTS public.live_activity_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  push_to_start_token text NOT NULL,
  bundle_id text NOT NULL,
  apns_environment text NOT NULL CHECK (apns_environment IN ('sandbox', 'production')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (auth_user_id, push_to_start_token)
);

CREATE INDEX IF NOT EXISTS idx_live_activity_tokens_auth_user_id
  ON public.live_activity_tokens (auth_user_id);

ALTER TABLE public.live_activity_tokens ENABLE ROW LEVEL SECURITY;

-- Escape hatch for Safari Web Push on Mac: keep medication banners even when
-- a Live Activity token exists for the same account (Decision Log T-0023).
ALTER TABLE public.push_subscriptions
  ADD COLUMN IF NOT EXISTS suppress_medication_push boolean NOT NULL DEFAULT false;

COMMENT ON TABLE public.live_activity_tokens IS
  'Per-device ActivityKit push-to-start tokens for medication Live Activities.';

COMMENT ON COLUMN public.live_activity_tokens.apns_environment IS
  'sandbox for Xcode development builds; production for TestFlight / App Store.';

COMMENT ON COLUMN public.push_subscriptions.suppress_medication_push IS
  'When true, omit medication items from Web Push for this subscription (other digest types still send); also used after APNs 200 for Apple Web Push endpoints. Not a whole-payload mute.';
