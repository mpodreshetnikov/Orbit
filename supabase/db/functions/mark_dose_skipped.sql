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
BEGIN
  -- Validate caller
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT e.id, e.regimen_id, e.status, e.planned_intake, e.actual_at
  INTO v_event
  FROM public.med_dose_events e
  WHERE e.id = p_dose_event_id
    AND e.status IN ('scheduled', 'sent', 'snoozed', 'taken')
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- If was taken, reverse inventory
  IF v_event.status = 'taken' THEN
    v_amount := (v_event.planned_intake->'intake'->>'amount')::numeric;
    v_unit := COALESCE(v_event.planned_intake->'intake'->>'unit', 'pill');
    IF v_amount IS NULL THEN v_amount := 1; END IF;

    PERFORM 1 FROM public.med_regimens r WHERE r.id = v_event.regimen_id FOR UPDATE;

    INSERT INTO public.med_inventory_transactions (regimen_id, event_id, type, amount, unit, note)
    VALUES (v_event.regimen_id, p_dose_event_id, 'correction', v_amount, v_unit, 'Change to skipped');

    -- Gated on `auto_decrement_on_taken` as well as `enabled`, because that is
    -- the pair the decrement being reversed was written under: with automatic
    -- decrementing off the intake never reduced `current_amount`, so adding the
    -- amount back here would create stock out of nothing and hold the figure
    -- above the refill threshold the reminder fires on.
    UPDATE public.med_regimens
    SET inventory = jsonb_set(
          inventory,
          '{current_amount}',
          to_jsonb(
            GREATEST(
              0,
              COALESCE((inventory->>'current_amount')::numeric, 0) + v_amount
            )
          ),
          true
        ),
        updated_at = now()
    WHERE id = v_event.regimen_id
      AND inventory IS NOT NULL
      AND (inventory->>'enabled')::boolean IS TRUE
      AND (inventory->>'auto_decrement_on_taken')::boolean IS TRUE;
  END IF;

  UPDATE public.med_dose_events
  SET status = 'skipped',
      taken_at = COALESCE(actual_at, now()),
      note = NULLIF(trim(p_note), ''),
      updated_at = now()
  WHERE id = p_dose_event_id
    AND status IN ('scheduled', 'sent', 'snoozed', 'taken');

  IF NOT FOUND THEN
    RETURN;
  END IF;
END;
$$;

-- Security: restrict execution
REVOKE ALL ON FUNCTION public.mark_dose_skipped(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_dose_skipped(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.mark_dose_skipped(uuid, text) IS
  'Mark dose event as skipped; allow from scheduled/sent/snoozed/taken. Reverses inventory if was taken. Serializes on the dose and regimen rows (T-0020).';
