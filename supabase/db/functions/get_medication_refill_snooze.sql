-- Function: get_medication_refill_snooze()
-- Get current recipient refill reminder snooze date for a regimen

CREATE OR REPLACE FUNCTION public.get_medication_refill_snooze(
  p_regimen_id uuid
)
RETURNS date
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_snooze_until date;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.med_regimens r
    WHERE r.id = p_regimen_id
      AND r.deleted_at IS NULL
      AND EXISTS (
        SELECT 1
        FROM public.get_routed_persons_for_recipient(auth.uid()) routed
        WHERE routed.person_id = r.person_id
      )
  ) THEN
    RETURN NULL;
  END IF;

  SELECT s.snooze_until
  INTO v_snooze_until
  FROM public.medication_refill_snoozes s
  WHERE s.recipient_user_id = auth.uid()
    AND s.regimen_id = p_regimen_id;

  RETURN v_snooze_until;
END;
$$;

REVOKE ALL ON FUNCTION public.get_medication_refill_snooze(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_medication_refill_snooze(uuid) TO authenticated;

COMMENT ON FUNCTION public.get_medication_refill_snooze(uuid) IS
  'Returns the current recipient-specific refill reminder snooze date for a regimen, or null.';
