-- Function: undo_dose_intake()
-- Revert dose event from taken/skipped to scheduled

CREATE OR REPLACE FUNCTION public.undo_dose_intake(p_dose_event_id uuid)
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

  SELECT e.id, e.regimen_id, e.status, e.planned_intake
  INTO v_event
  FROM public.med_dose_events e
  WHERE e.id = p_dose_event_id
    AND e.status IN ('taken', 'skipped', 'missed')
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_event.status = 'taken' THEN
    v_unit := COALESCE(v_event.planned_intake->'intake'->>'unit', 'pill');

    PERFORM 1 FROM public.med_regimens r WHERE r.id = v_event.regimen_id FOR UPDATE;

    -- Reverse the event's outstanding ledger net, not the regimen settings now
    -- in force (T-260901-pou).
    SELECT COALESCE(
             SUM(
               CASE t.type
                 WHEN 'decrement' THEN t.amount
                 WHEN 'correction' THEN -t.amount
                 ELSE 0
               END
             ),
             0
           ),
           COALESCE(
             (
               SELECT t.unit
               FROM public.med_inventory_transactions t
               WHERE t.event_id = p_dose_event_id
                 AND t.type = 'decrement'
               ORDER BY t.created_at DESC
               LIMIT 1
             ),
             v_unit
           )
    INTO v_amount, v_unit
    FROM public.med_inventory_transactions t
    WHERE t.event_id = p_dose_event_id;

    IF v_amount > 0 THEN
      INSERT INTO public.med_inventory_transactions (regimen_id, event_id, type, amount, unit, note)
      VALUES (v_event.regimen_id, p_dose_event_id, 'correction', v_amount, v_unit, 'Undo intake');

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
        AND inventory IS NOT NULL;
    END IF;
  END IF;

  UPDATE public.med_dose_events
  SET status = 'scheduled',
      taken_at = NULL,
      note = NULL,
      updated_at = now()
  WHERE id = p_dose_event_id
    AND status IN ('taken', 'skipped', 'missed');

  IF NOT FOUND THEN
    RETURN;
  END IF;
END;
$$;

-- Security: restrict execution
REVOKE ALL ON FUNCTION public.undo_dose_intake(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.undo_dose_intake(uuid) TO authenticated;

COMMENT ON FUNCTION public.undo_dose_intake(uuid) IS
  'Revert dose event from taken/skipped to scheduled; restores inventory from the event ledger net when stock moved (T-260901-pou). Serializes on the dose and regimen rows (T-0020).';
