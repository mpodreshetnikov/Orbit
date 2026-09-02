-- What justified a proposed closure, and whether anyone has ruled on it.
--
-- A machine-authored resolution no longer moves a condition's status on its own: it is a proposal,
-- and a person confirms it. Two things were missing for that to be reviewable at all.
--
-- The measurement behind the proposal existed only in the reconcile stage's transient output, so
-- once extraction finished nothing could say which observation justified closing the condition. A
-- review screen could show that a proposal exists and not what it rests on.
--
-- And review state had nowhere to live. `is_user_verified` defaults to false, so false already
-- means "created and not yet reviewed"; a dismissal recorded as false is indistinguishable from a
-- proposal nobody has opened, and deleting a dismissed row destroys the labelled rejection that
-- curating the analyte table depends on. Counting confirmations against dismissals -- which is how
-- an uncertain entry earns the right to close a condition without asking -- needs those three
-- states kept apart.
ALTER TABLE public.condition_records
  ADD COLUMN IF NOT EXISTS supporting_obs_code text,
  ADD COLUMN IF NOT EXISTS review_decision text NOT NULL DEFAULT 'pending';

DO $$
BEGIN
  ALTER TABLE public.condition_records
    ADD CONSTRAINT condition_records_review_decision_check
    CHECK (review_decision IN ('pending', 'confirmed', 'dismissed'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

COMMENT ON COLUMN public.condition_records.supporting_obs_code IS
  'Observation catalogue code of the measurement that justified this proposed resolution, checked against the document''s own observations before the row was written. Null on any mention that is not a lab-driven resolution.';
COMMENT ON COLUMN public.condition_records.review_decision IS
  'Whether a person has ruled on this mention: pending (nobody has looked), confirmed, or dismissed. Distinct from is_user_verified, which cannot tell a rejection from an unopened proposal.';

-- Every row predating this reads as pending, which is accurate: nobody reviewed them under a
-- scheme that did not exist. Both columns are additive with a default, so no backfill is needed.

-- The promotion query in T-0026 groups every proposal by the analyte that justified it, so that is
-- the access path worth an index; the partial predicate keeps it to the rows that have one.
CREATE INDEX IF NOT EXISTS idx_condition_records_supporting_obs_code
  ON public.condition_records(supporting_obs_code)
  WHERE supporting_obs_code IS NOT NULL;
