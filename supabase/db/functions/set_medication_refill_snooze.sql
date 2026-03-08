-- Function: set_medication_refill_snooze()
-- Set or clear current recipient refill reminder snooze date for a regimen

CREATE OR REPLACE FUNCTION public.set_medication_refill_snooze(
  p_regimen_id uuid,
  p_snooze_until date
)
RETURNS date
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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

  IF p_snooze_until IS NULL THEN
    DELETE FROM public.medication_refill_snoozes
    WHERE recipient_user_id = auth.uid()
      AND regimen_id = p_regimen_id;
  ELSE
    INSERT INTO public.medication_refill_snoozes (
      recipient_user_id,
      regimen_id,
      snooze_until
    )
    VALUES (
      auth.uid(),
      p_regimen_id,
      p_snooze_until
    )
    ON CONFLICT (recipient_user_id, regimen_id)
    DO UPDATE SET
      snooze_until = EXCLUDED.snooze_until,
      updated_at = now();
  END IF;

  UPDATE public.notification_digests
  SET sent_at = now()
  WHERE auth_user_id = auth.uid()
    AND type = 'medication_refill'
    AND (payload_json->>'regimen_id') = p_regimen_id::text
    AND sent_at IS NULL;

  RETURN p_snooze_until;
END;
$$;

REVOKE ALL ON FUNCTION public.set_medication_refill_snooze(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_medication_refill_snooze(uuid, date) TO authenticated;

COMMENT ON FUNCTION public.set_medication_refill_snooze(uuid, date) IS
  'Sets or clears the current recipient-specific refill reminder snooze date for a regimen and dismisses unsent refill digests for that recipient.';
