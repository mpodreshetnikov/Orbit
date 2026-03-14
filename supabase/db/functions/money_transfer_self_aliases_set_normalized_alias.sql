-- Function: money_transfer_self_aliases_set_normalized_alias()
-- Normalizes alias text before persistence.

CREATE OR REPLACE FUNCTION public.money_transfer_self_aliases_set_normalized_alias()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.alias := btrim(NEW.alias);
  NEW.normalized_alias := public.money_normalize_transfer_text(NEW.alias);

  IF NEW.normalized_alias IS NULL THEN
    RAISE EXCEPTION 'Self-transfer alias cannot be empty after normalization';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.money_transfer_self_aliases_set_normalized_alias() IS
  'Trigger function that normalizes money transfer self aliases before insert or update.';
