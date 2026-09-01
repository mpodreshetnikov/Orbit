-- Function: release_abandoned_record_processing()
-- Give back the records whose worker never came back.
--
-- The browser used to be the timeout: it aborted the OCR call after two minutes and wrote
-- `ocr_failed` itself. That was wrong about live runs -- a five-page document is not a failure --
-- and it is gone now that the pipelines run past the request. But something still has to answer
-- for a worker that dies mid-document, or the record sits in `ocr_processing` forever with
-- nobody working on it and no way for the user to retry.
--
-- The claim's lease already says what "abandoned" means, so this reuses it rather than inventing
-- a second timeout. A run that is alive renews; one that stopped goes quiet and its record comes
-- back to the user with an error it can act on.

CREATE OR REPLACE FUNCTION public.release_abandoned_record_processing(
  p_lease_seconds integer DEFAULT 900,
  p_structuring_lease_seconds integer DEFAULT 3600
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
        -- Structuring does not renew: its whole run is one claim, and three staged model calls
        -- with retries and provider backoff can legitimately outlive the OCR lease. Reaping it
        -- on that lease would take a document away from a worker still reading it and throw the
        -- completed work away, so it gets its own, longer one.
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
