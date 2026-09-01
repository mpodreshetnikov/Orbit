-- A session minted by a grant remembers which grant minted it.
--
-- Without this, revoking a grant -- or removing its issuer from allowed_users -- left any session
-- it had already opened working for the rest of its 15-minute lifetime: the session records the
-- issuer's uuid and nothing that points back at the credential, so session authentication had
-- nothing to re-check. Fifteen minutes is bounded, which is why this was not the most urgent hole,
-- but "revoked" that keeps importing for a quarter of an hour is not what the word means.
--
-- ON DELETE CASCADE rather than SET NULL: deleting a grant should take its sessions with it. A
-- session that outlived the credential it came from, with the link nulled, would be indistinguishable
-- from one a person opened themselves.

ALTER TABLE public.money_import_sessions
  ADD COLUMN IF NOT EXISTS grant_id uuid REFERENCES public.money_import_grants(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_money_import_sessions_grant_id
  ON public.money_import_sessions(grant_id);

COMMENT ON COLUMN public.money_import_sessions.grant_id IS
  'The import grant this session was minted by, when it was minted by one. Re-checked on every session-authenticated request so revoking the grant ends its sessions too.';
