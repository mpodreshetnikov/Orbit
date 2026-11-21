-- Function: mark_dose_taken()
-- Mark a dose event as taken and update inventory

DROP FUNCTION IF EXISTS public.mark_dose_taken(uuid, text);

CREATE OR REPLACE FUNCTION public.mark_dose_taken(
  p_dose_event_id uuid,
  p_note text DEFAULT NULL,
  p_taken_at timestamptz DEFAULT NULL
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

  -- SECURITY DEFINER bypasses RLS; refuse non-allowlisted authenticated callers
  -- the same way money category RPCs do (T-261113-qgz).
  IF COALESCE(current_setting('role', true), '') = 'authenticated'
    AND NOT public.is_allowed_user() THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Lock the dose row before the status guard so a concurrent caller waits and
  -- re-reads rather than both passing a stale scheduled/sent/snoozed/skipped check.
  SELECT e.id, e.regimen_id, e.planned_intake, e.actual_at
  INTO v_event
  FROM public.med_dose_events e
  WHERE e.id = p_dose_event_id
    AND e.status IN ('scheduled', 'sent', 'snoozed', 'skipped')
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_amount := (v_event.planned_intake->'intake'->>'amount')::numeric;
  v_unit := COALESCE(v_event.planned_intake->'intake'->>'unit', 'pill');
  IF v_amount IS NULL THEN v_amount := 1; END IF;

  -- Lock the regimen before any inventory read-modify-write so a concurrent
  -- refill/correction cannot lose an update to med_regimens.inventory.
  PERFORM 1 FROM public.med_regimens r WHERE r.id = v_event.regimen_id FOR UPDATE;

  UPDATE public.med_dose_events
  SET status = 'taken',
      taken_at = COALESCE(p_taken_at, actual_at, now()),
      note = NULLIF(trim(p_note), ''),
      updated_at = now()
  WHERE id = p_dose_event_id
    AND status IN ('scheduled', 'sent', 'snoozed', 'skipped');

  -- Re-check in the UPDATE predicate: a transition must not apply twice even if
  -- the SELECT guard was somehow passed twice.
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Field-level jsonb_set on the live column (not a whole-object write of a
  -- previously read snapshot) so an unrelated concurrent edit to another
  -- inventory field is not discarded once this session holds the row lock.
  -- Ledger rows record movements only (T-260901-pou): write a decrement when
  -- this UPDATE actually reduces stock, never as a receipt of the intake ask.
  UPDATE public.med_regimens
  SET inventory = jsonb_set(
        inventory,
        '{current_amount}',
        to_jsonb(
          GREATEST(
            0,
            COALESCE((inventory->>'current_amount')::numeric, 0) - v_amount
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
    VALUES (v_event.regimen_id, p_dose_event_id, 'decrement', v_amount, v_unit, NULLIF(trim(p_note), ''));
  END IF;
END;
$$;

-- Security: restrict execution
REVOKE ALL ON FUNCTION public.mark_dose_taken(uuid, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_dose_taken(uuid, text, timestamptz) TO authenticated;

COMMENT ON FUNCTION public.mark_dose_taken(uuid, text, timestamptz) IS
  'Mark dose event as taken; allow from scheduled/sent/snoozed/skipped. Optional p_taken_at sets completion time; else actual_at, else now(). Decrements inventory when enabled and auto_decrement_on_taken, and records a ledger decrement only when stock moved (T-260901-pou). Serializes on the dose and regimen rows (T-0020).';
