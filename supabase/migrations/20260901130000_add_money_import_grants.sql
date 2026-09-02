-- Money import grants: a long-lived, revocable credential the extension can start with.
--
-- Until now every import began on the app page, because the extension had no credential of
-- its own — it borrowed the signed-in user's session. That is what forces a human to be
-- present for every import, and it is the last obstacle to an unattended one.
--
-- The token itself is never stored: the app shows it once and keeps only its SHA-256, the
-- same shape money_import_sessions already uses for its short-lived tokens.

CREATE TABLE IF NOT EXISTS public.money_import_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES public.persons(id) ON DELETE CASCADE,
  created_by_auth_user_id uuid NOT NULL,
  label text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  allowed_sources text[] NOT NULL DEFAULT '{}',
  expires_at timestamptz,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_money_import_grants_person_id
  ON public.money_import_grants(person_id);

ALTER TABLE public.money_import_grants ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.money_import_grants IS
  'Long-lived revocable credentials that let the browser extension start an import session on its own.';
COMMENT ON COLUMN public.money_import_grants.token_hash IS
  'SHA-256 of the issued token. The token itself is shown once and never stored.';
COMMENT ON COLUMN public.money_import_grants.allowed_sources IS
  'Import sources this grant may create sessions for. A source outside the list is refused.';
