-- Function: update_regimen_inventory()
-- Update regimen inventory with refill/set_absolute/correction

CREATE OR REPLACE FUNCTION public.update_regimen_inventory(
  p_regimen_id uuid,
  p_type text,
  p_amount numeric,
  p_note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_inv jsonb;
  v_current numeric;
  v_unit text;
  v_next numeric;
BEGIN
  -- Validate caller
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_type NOT IN ('refill', 'set_absolute', 'correction') OR p_amount IS NULL THEN
    RETURN;
  END IF;

  -- Lock the regimen before reading inventory so concurrent writers cannot
  -- overwrite each other's field-level changes with a stale whole-object write.
  SELECT r.inventory INTO v_inv
  FROM public.med_regimens r
  WHERE r.id = p_regimen_id
  FOR UPDATE;

  IF v_inv IS NULL OR (v_inv->>'enabled')::boolean IS NOT TRUE THEN
    RETURN;
  END IF;

  v_unit := COALESCE(v_inv->>'unit', 'pill');
  v_current := COALESCE((v_inv->>'current_amount')::numeric, 0);

  IF p_type = 'refill' THEN
    v_next := v_current + p_amount;
  ELSIF p_type = 'set_absolute' THEN
    v_next := GREATEST(0, p_amount);
  ELSE
    v_next := GREATEST(0, v_current + p_amount);
  END IF;

  INSERT INTO public.med_inventory_transactions (regimen_id, event_id, type, amount, unit, note)
  VALUES (p_regimen_id, NULL, p_type::public.med_inventory_transaction_type, p_amount, v_unit, NULLIF(trim(p_note), ''));

  UPDATE public.med_regimens
  SET inventory = jsonb_set(inventory, '{current_amount}', to_jsonb(v_next), true),
      updated_at = now()
  WHERE id = p_regimen_id;
END;
$$;

-- Security: restrict execution
REVOKE ALL ON FUNCTION public.update_regimen_inventory(uuid, text, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_regimen_inventory(uuid, text, numeric, text) TO authenticated;

COMMENT ON FUNCTION public.update_regimen_inventory(uuid, text, numeric, text) IS
  'Insert inventory transaction (refill/set_absolute/correction) and update regimen inventory current_amount. Serializes on the regimen row (T-0020).';
