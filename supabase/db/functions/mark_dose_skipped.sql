-- Function: mark_dose_skipped()
-- Mark a dose event as skipped

CREATE OR REPLACE FUNCTION public.mark_dose_skipped(
  p_dose_event_id uuid,
  p_note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_event record;
  v_amount numeric;
  v_unit text;
  v_inv jsonb;
BEGIN
  -- Validate caller
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT e.id, e.regimen_id, e.status, e.planned_intake, e.actual_at
  INTO v_event
  FROM public.med_dose_events e
  WHERE e.id = p_dose_event_id
    AND e.status IN ('scheduled', 'sent', 'snoozed', 'taken');

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- If was taken, reverse inventory
  IF v_event.status = 'taken' THEN
    v_amount := (v_event.planned_intake->'intake'->>'amount')::numeric;
    v_unit := COALESCE(v_event.planned_intake->'intake'->>'unit', 'pill');
    IF v_amount IS NULL THEN v_amount := 1; END IF;

    INSERT INTO public.med_inventory_transactions (regimen_id, event_id, type, amount, unit, note)
    VALUES (v_event.regimen_id, p_dose_event_id, 'correction', v_amount, v_unit, 'Change to skipped');

    SELECT r.inventory INTO v_inv FROM public.med_regimens r WHERE r.id = v_event.regimen_id;
    IF v_inv IS NOT NULL AND (v_inv->>'enabled')::boolean IS TRUE THEN
      v_inv := jsonb_set(
        v_inv,
        '{current_amount}',
        to_jsonb(GREATEST(0, COALESCE((v_inv->>'current_amount')::numeric, 0) + v_amount)),
        true
      );
      UPDATE public.med_regimens SET inventory = v_inv, updated_at = now() WHERE id = v_event.regimen_id;
    END IF;
  END IF;

  UPDATE public.med_dose_events
  SET status = 'skipped', taken_at = COALESCE(actual_at, now()), note = NULLIF(trim(p_note), ''), updated_at = now()
  WHERE id = p_dose_event_id;
END;
$$;

-- Security: restrict execution
REVOKE ALL ON FUNCTION public.mark_dose_skipped(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_dose_skipped(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.mark_dose_skipped(uuid, text) IS
  'Mark dose event as skipped; allow from scheduled/sent/snoozed/taken. Reverses inventory if was taken.';
