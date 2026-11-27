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
  v_moved numeric;
  v_unit text;
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
    AND e.status IN ('taken', 'skipped')
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_unit := COALESCE(v_event.planned_intake->'intake'->>'unit', 'pill');

  IF v_event.status = 'taken' AND p_amount_taken IS NOT NULL THEN
    v_old_amount := (v_event.planned_intake->'intake'->>'amount')::numeric;
    IF v_old_amount IS NULL THEN v_old_amount := 1; END IF;
    v_new_amount := GREATEST(0, p_amount_taken);

    IF v_new_amount <> v_old_amount THEN
      PERFORM 1 FROM public.med_regimens r WHERE r.id = v_event.regimen_id FOR UPDATE;

      -- Outstanding stock attributed to this event on the ledger (T-260901-pou).
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
      INTO v_moved, v_unit
      FROM public.med_inventory_transactions t
      WHERE t.event_id = p_dose_event_id;

      IF v_moved > 0 THEN
        INSERT INTO public.med_inventory_transactions (regimen_id, event_id, type, amount, unit, note)
        VALUES (v_event.regimen_id, p_dose_event_id, 'correction', v_moved, v_unit, 'Edit amount taken');

        UPDATE public.med_regimens
        SET inventory = jsonb_set(
              inventory,
              '{current_amount}',
              to_jsonb(
                GREATEST(
                  0,
                  COALESCE((inventory->>'current_amount')::numeric, 0) + v_moved
                )
              ),
              true
            ),
            updated_at = now()
        WHERE id = v_event.regimen_id
          AND inventory IS NOT NULL;
      END IF;

      -- Applying the new amount is a fresh movement: only when settings still
      -- auto-decrement, and only then write a ledger decrement.
      UPDATE public.med_regimens
      SET inventory = jsonb_set(
            inventory,
            '{current_amount}',
            to_jsonb(
              GREATEST(
                0,
                COALESCE((inventory->>'current_amount')::numeric, 0) - v_new_amount
              )
            ),
            true
          ),
          updated_at = now()
      WHERE id = v_event.regimen_id
        AND inventory IS NOT NULL
        AND (inventory->>'enabled')::boolean IS TRUE
        AND (inventory->>'auto_decrement_on_taken')::boolean IS TRUE;

      IF FOUND THEN
        INSERT INTO public.med_inventory_transactions (regimen_id, event_id, type, amount, unit, note)
        VALUES (
          v_event.regimen_id,
          p_dose_event_id,
          'decrement',
          v_new_amount,
          v_unit,
          NULLIF(trim(COALESCE(p_note, '')), '')
        );
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
      WHERE id = p_dose_event_id
        AND status IN ('taken', 'skipped');
      RETURN;
    END IF;
  END IF;

  UPDATE public.med_dose_events
  SET taken_at = COALESCE(p_taken_at, taken_at),
      note = CASE WHEN p_note IS NOT NULL THEN NULLIF(trim(p_note), '') ELSE note END,
      updated_at = now()
  WHERE id = p_dose_event_id
    AND status IN ('taken', 'skipped');
END;
$$;

-- Security: restrict execution
REVOKE ALL ON FUNCTION public.update_dose_event_resolution_details(uuid, timestamptz, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_dose_event_resolution_details(uuid, timestamptz, numeric, text) TO authenticated;

COMMENT ON FUNCTION public.update_dose_event_resolution_details(uuid, timestamptz, numeric, text) IS
  'Update taken_at, note, and optionally amount taken (for taken events). Reverses outstanding ledger net then applies a new decrement only when stock moves (T-260901-pou). Serializes on the dose and regimen rows (T-0020).';
