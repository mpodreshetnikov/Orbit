-- Function: claim_medical_record()
-- Take ownership of a record for one pipeline run, or report that someone else holds it.
--
-- The claim has to be one statement. Expressed as a PostgREST filter it was three things that
-- could disagree -- an equality, an OR group and a timestamp rendered into a query string -- for
-- a condition whose whole job is to be evaluated atomically. Here the predicate is evaluated by
-- the database against its own clock, and the caller gets a plain answer: true when this run now
-- owns the record, false when another run does.

CREATE OR REPLACE FUNCTION public.claim_medical_record(
  p_record_id uuid,
  p_run_id uuid,
  p_status text,
  p_lease_seconds integer DEFAULT 900
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_claimed boolean;
BEGIN
  UPDATE public.medical_records
  SET
    processing_run_id = p_run_id,
    processing_started_at = now(),
    status = p_status::public.record_status
  WHERE id = p_record_id
    -- Unclaimed, or the previous claim has outlived its lease and its worker with it.
    AND (
      processing_run_id IS NULL
      OR processing_started_at IS NULL
      OR processing_started_at < now() - make_interval(secs => p_lease_seconds)
    )
  RETURNING true INTO v_claimed;

  RETURN COALESCE(v_claimed, false);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_medical_record(uuid, uuid, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_medical_record(uuid, uuid, text, integer) TO service_role;

COMMENT ON FUNCTION public.claim_medical_record(uuid, uuid, text, integer) IS
  'Atomically claims a medical record for one pipeline run, returning false when another run already owns it and its lease has not expired.';

-- Function: renew_medical_record_claim()
-- Keep a live run's claim from expiring under it.
--
-- The lease exists to free a record from a worker that died, which means it has to be shorter
-- than "however long the pipeline might take" -- and OCR over ten attachments, each with retries
-- and provider-dictated backoff, can run longer than any lease worth setting. A run that is still
-- working says so; one that stopped says nothing and loses the record, which is the point.

CREATE OR REPLACE FUNCTION public.renew_medical_record_claim(
  p_record_id uuid,
  p_run_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_renewed boolean;
BEGIN
  UPDATE public.medical_records
  SET processing_started_at = now()
  WHERE id = p_record_id
    AND processing_run_id = p_run_id
  RETURNING true INTO v_renewed;

  RETURN COALESCE(v_renewed, false);
END;
$$;

REVOKE ALL ON FUNCTION public.renew_medical_record_claim(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.renew_medical_record_claim(uuid, uuid) TO service_role;

COMMENT ON FUNCTION public.renew_medical_record_claim(uuid, uuid) IS
  'Extends the lease on a claim this run still holds, returning false when the claim has been taken over.';
