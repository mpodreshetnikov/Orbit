-- Function: update_dose_event_resolution_details()
-- Update taken_at, note, and optionally amount taken

CREATE OR REPLACE FUNCTION public.update_dose_event_resolution_details(
  p_dose_event_id uuid,
  p_taken_at timestamptz DEFAULT NULL,
  p_amount_taken numeric DEFAULT NULL,
  p_note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_event record;
  v_old_amount numeric;
  v_new_amount numeric;
  v_unit text;
  v_inv jsonb;
  v_planned jsonb;
BEGIN
  -- Validate caller
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT e.id, e.regimen_id, e.status, e.planned_intake
  INTO v_event
  FROM public.med_dose_events e
  WHERE e.id = p_dose_event_id
    AND e.status IN ('taken', 'skipped');

  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_unit := COALESCE(v_event.planned_intake->'intake'->>'unit', 'pill');

  IF v_event.status = 'taken' AND p_amount_taken IS NOT NULL THEN
    v_old_amount := (v_event.planned_intake->'intake'->>'amount')::numeric;
    IF v_old_amount IS NULL THEN v_old_amount := 1; END IF;
    v_new_amount := GREATEST(0, p_amount_taken);

    IF v_new_amount <> v_old_amount THEN
      -- Reverse old amount
      INSERT INTO public.med_inventory_transactions (regimen_id, event_id, type, amount, unit, note)
      VALUES (v_event.regimen_id, p_dose_event_id, 'correction', v_old_amount, v_unit, 'Edit amount taken');

      -- Gated on `auto_decrement_on_taken` as well as `enabled`, because that
      -- is the pair the decrement being reversed was written under: with
      -- automatic decrementing off the intake never reduced `current_amount`,
      -- so adding the old amount back here would create stock out of nothing
      -- and suppress the refill reminder that stock drives.
      SELECT r.inventory INTO v_inv FROM public.med_regimens r WHERE r.id = v_event.regimen_id;
      IF v_inv IS NOT NULL
         AND (v_inv->>'enabled')::boolean IS TRUE
         AND (v_inv->>'auto_decrement_on_taken')::boolean IS TRUE THEN
        v_inv := jsonb_set(
          v_inv,
          '{current_amount}',
          to_jsonb(GREATEST(0, COALESCE((v_inv->>'current_amount')::numeric, 0) + v_old_amount)),
          true
        );
        UPDATE public.med_regimens SET inventory = v_inv, updated_at = now() WHERE id = v_event.regimen_id;
      END IF;

      -- Apply new amount
      INSERT INTO public.med_inventory_transactions (regimen_id, event_id, type, amount, unit, note)
      VALUES (v_event.regimen_id, p_dose_event_id, 'decrement', v_new_amount, v_unit, NULLIF(trim(COALESCE(p_note, '')), ''));

      SELECT r.inventory INTO v_inv FROM public.med_regimens r WHERE r.id = v_event.regimen_id;
      IF v_inv IS NOT NULL AND (v_inv->>'enabled')::boolean IS TRUE AND (v_inv->>'auto_decrement_on_taken')::boolean IS TRUE THEN
        v_inv := jsonb_set(v_inv, '{current_amount}', to_jsonb(GREATEST(0, COALESCE((v_inv->>'current_amount')::numeric, 0) - v_new_amount)), true);
        UPDATE public.med_regimens SET inventory = v_inv, updated_at = now() WHERE id = v_event.regimen_id;
      END IF;

      v_planned := jsonb_set(
        COALESCE(v_event.planned_intake, '{"intake":{"amount":1,"unit":"pill"},"active":[]}'::jsonb),
        '{intake}',
        COALESCE(v_event.planned_intake->'intake', '{}'::jsonb) || jsonb_build_object('amount', v_new_amount, 'unit', v_unit)
      );
      UPDATE public.med_dose_events
      SET planned_intake = v_planned,
          taken_at = COALESCE(p_taken_at, taken_at),
          note = CASE WHEN p_note IS NOT NULL THEN NULLIF(trim(p_note), '') ELSE note END,
          updated_at = now()
      WHERE id = p_dose_event_id;
      RETURN;
    END IF;
  END IF;

  UPDATE public.med_dose_events
  SET taken_at = COALESCE(p_taken_at, taken_at),
      note = CASE WHEN p_note IS NOT NULL THEN NULLIF(trim(p_note), '') ELSE note END,
      updated_at = now()
  WHERE id = p_dose_event_id;
END;
$$;

-- Security: restrict execution
REVOKE ALL ON FUNCTION public.update_dose_event_resolution_details(uuid, timestamptz, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_dose_event_resolution_details(uuid, timestamptz, numeric, text) TO authenticated;

COMMENT ON FUNCTION public.update_dose_event_resolution_details(uuid, timestamptz, numeric, text) IS
  'Update taken_at, note, and optionally amount taken (for taken events; adjusts inventory).';
