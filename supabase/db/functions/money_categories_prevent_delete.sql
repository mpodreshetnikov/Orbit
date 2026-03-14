-- Function: money_categories_prevent_delete()
-- Prevents deleting protected canonical categories.
CREATE OR REPLACE FUNCTION public.money_categories_prevent_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.category_kind = 'canonical' THEN
    RAISE EXCEPTION 'Canonical categories cannot be deleted';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.money_categories
    WHERE parent_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'Cannot delete a money category that is still in use';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.money_line_items
    WHERE category_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'Cannot delete a money category that is still in use';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.money_category_rules
    WHERE target_category_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'Cannot delete a money category that is still in use';
  END IF;

  RETURN OLD;
END;
$$;

COMMENT ON FUNCTION public.money_categories_prevent_delete() IS
  'Trigger function that prevents deleting built-in canonical money categories.';
