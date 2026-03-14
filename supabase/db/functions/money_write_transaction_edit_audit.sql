-- Function: money_write_transaction_edit_audit()
-- Trigger helper that writes audit rows for money_transactions and money_line_items updates.

CREATE OR REPLACE FUNCTION public.money_write_transaction_edit_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_before_snapshot jsonb := to_jsonb(OLD);
  v_after_snapshot jsonb := to_jsonb(NEW);
  v_entity_kind text;
  v_transaction_id uuid;
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF (v_before_snapshot - 'updated_at') = (v_after_snapshot - 'updated_at') THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'money_transactions' THEN
    v_entity_kind := 'transaction';
    v_transaction_id := NEW.id;
  ELSIF TG_TABLE_NAME = 'money_line_items' THEN
    v_entity_kind := 'line_item';
    v_transaction_id := NEW.transaction_id;
  ELSE
    RAISE EXCEPTION 'money_write_transaction_edit_audit does not support table %', TG_TABLE_NAME;
  END IF;

  INSERT INTO public.money_transaction_edit_audits (
    transaction_id,
    entity_kind,
    entity_id,
    before_snapshot,
    after_snapshot,
    edited_by_auth_user_id
  )
  VALUES (
    v_transaction_id,
    v_entity_kind,
    NEW.id,
    v_before_snapshot,
    v_after_snapshot,
    auth.uid()
  );

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.money_write_transaction_edit_audit() IS
  'Trigger helper that records money transaction and line item edits into money_transaction_edit_audits.';
