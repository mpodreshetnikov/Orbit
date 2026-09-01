-- Something has to answer for a worker that dies mid-document.
--
-- With OCR and structuring running past the request, the browser is no longer the timeout that
-- ends a stuck record -- and it should never have been, since it could not tell a dead worker
-- from a five-page document still being transcribed. The claim's lease already carries that
-- distinction: a live run renews it, a dead one does not. This releases what the lease has
-- given up on, back to a state the user can retry from.

CREATE OR REPLACE FUNCTION public.release_abandoned_record_processing(
  p_lease_seconds integer DEFAULT 900
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
    WHERE status IN ('ocr_processing', 'structuring')
      -- A record can sit in a processing status without a claim: the client moves it there
      -- before the function is reached, and the request may never arrive. `updated_at` is the
      -- only clock those rows have.
      AND COALESCE(processing_started_at, updated_at) < now() - make_interval(secs => p_lease_seconds)
    RETURNING 1
  )
  SELECT count(*)::integer INTO v_released FROM released;

  RETURN v_released;
END;
$$;

REVOKE ALL ON FUNCTION public.release_abandoned_record_processing(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.release_abandoned_record_processing(integer) TO service_role;

COMMENT ON FUNCTION public.release_abandoned_record_processing(integer) IS
  'Returns records whose processing claim outlived its lease to a state the user can retry from, and reports how many were released.';

-- Scheduled here as well as in supabase/db/cron/jobs.sql, so a deployed database picks the job
-- up with the migration rather than waiting for the next full cron apply.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('release-abandoned-record-processing')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'release-abandoned-record-processing');

    PERFORM cron.schedule(
      'release-abandoned-record-processing',
      '*/5 * * * *',
      $job$SELECT public.release_abandoned_record_processing()$job$
    );
  END IF;
END $$;
