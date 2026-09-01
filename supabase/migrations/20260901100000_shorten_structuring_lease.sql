-- Structuring renews its claim, so it no longer needs an hour of grace.
--
-- The longer lease existed for one reason: the whole structuring run was a single claim, and
-- three staged model calls with retries and provider backoff can outrun any lease short enough
-- to be useful. Reaped on the OCR lease, a worker still reading the document would have lost the
-- record and thrown away everything it had done. Now the parse says it is still alive between
-- stages, which is what a lease is for -- and a dead structuring worker stops holding its record
-- for an hour.

CREATE OR REPLACE FUNCTION public.release_abandoned_record_processing(
  p_lease_seconds integer DEFAULT 900,
  p_structuring_lease_seconds integer DEFAULT 900
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_released integer;
  v_message constant text :=
    'Processing stopped unexpectedly and was released. Retry to run it again.';
BEGIN
  WITH released AS (
    UPDATE public.medical_records
    SET
      -- OCR has its own terminal status with a Retry beside it; structuring has none, so a
      -- released record goes back to the review step it was started from.
      status = CASE
        WHEN status = 'ocr_processing' THEN 'ocr_failed'::public.record_status
        ELSE 'ocr_review'::public.record_status
      END,
      ocr_error = CASE WHEN status = 'ocr_processing' THEN v_message ELSE ocr_error END,
      structure_error = CASE WHEN status = 'structuring' THEN v_message ELSE structure_error END,
      processing_run_id = NULL,
      processing_started_at = NULL
    WHERE (
        -- OCR renews its claim after every page, so a claim that has gone quiet for a lease is
        -- a worker that stopped.
        (status = 'ocr_processing'
          AND COALESCE(processing_started_at, updated_at) < now() - make_interval(secs => p_lease_seconds))
        -- Structuring renews between stages now, so it no longer needs a lease long enough for
        -- its own worst case -- an hour during which a dead worker held its record. The
        -- parameter stays because the two are separate leases in principle, and an operator may
        -- want to move one without the other.
        OR (status = 'structuring'
          AND COALESCE(processing_started_at, updated_at) < now() - make_interval(secs => p_structuring_lease_seconds))
      )
    RETURNING 1
  )
  SELECT count(*)::integer INTO v_released FROM released;

  RETURN v_released;
END;
$$;

REVOKE ALL ON FUNCTION public.release_abandoned_record_processing(integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.release_abandoned_record_processing(integer, integer) TO service_role;

COMMENT ON FUNCTION public.release_abandoned_record_processing(integer, integer) IS
  'Returns records whose processing claim outlived its lease to a state the user can retry from, and reports how many were released. Structuring carries a longer lease because it does not renew its claim.';
