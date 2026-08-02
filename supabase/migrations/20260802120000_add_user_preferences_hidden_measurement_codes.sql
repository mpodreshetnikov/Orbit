-- ----------------------------------------------------------------------------
-- Per-person hidden measurement types.
--
-- Lets a user tuck away measurement types they rarely record (height, say) so
-- they stop cluttering the measurements list, without deleting any data.
--
-- Stored on user_preferences rather than in a dedicated table: the preference
-- is per auth user, and this table already carries owner-scoped RLS
-- (auth_user_id = auth.uid()) plus an upsert path, so no new policies or
-- policy tests are needed. It is deliberately NOT on persons, which is
-- SELECT-only for clients by design.
--
-- Shape: {"<person_id>": ["height", "bmi"]}
--
-- Codes carry no foreign key to measurement_catalog. A hidden code whose
-- catalog row is later deleted is inert -- it simply matches nothing -- so
-- callers must derive any "N hidden" count from the measurements actually
-- present, never from the length of this list.
--
-- This only affects the measurements list. Hidden types still appear in the
-- Add Measurement dropdown, so a value can be recorded without unhiding first.
-- ----------------------------------------------------------------------------
ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS hidden_measurement_codes jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.user_preferences.hidden_measurement_codes IS 'Measurement catalog codes hidden from the measurements list, keyed by person id: {"<person_id>": ["height"]}. Display preference only - hidden types still appear in the Add Measurement dropdown and no measurement data is affected.';
