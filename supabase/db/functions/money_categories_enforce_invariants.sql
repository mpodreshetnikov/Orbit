-- Function: money_categories_enforce_invariants()
-- Enforces canonical/custom category invariants and keeps custom trees branch-safe.
CREATE OR REPLACE FUNCTION public.money_categories_enforce_invariants()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_parent public.money_categories%ROWTYPE;
  v_canonical public.money_categories%ROWTYPE;
  v_allowed_system_keys constant text[] := ARRAY[
    'income',
    'transfers',
    'housing',
    'utilities',
    'food',
    'transport',
    'shopping',
    'health',
    'education',
    'entertainment',
    'travel',
    'family',
    'pets',
    'services_fees',
    'gifts_donations',
    'taxes',
    'savings_investments',
    'business',
    'other',
    'uncategorized',
    'needs_review'
  ];
BEGIN
  IF NEW.id IS NULL THEN
    NEW.id := gen_random_uuid();
  END IF;

  IF NEW.category_kind IS NULL THEN
    RAISE EXCEPTION 'Money categories must define category_kind';
  END IF;

  IF NEW.category_kind = 'canonical' THEN
    IF TG_OP = 'UPDATE' AND OLD.category_kind = 'custom' THEN
      RAISE EXCEPTION 'Custom categories cannot be promoted to canonical';
    END IF;

    IF TG_OP = 'UPDATE'
      AND OLD.category_kind = 'canonical'
      AND (
        NEW.category_kind IS DISTINCT FROM OLD.category_kind
        OR NEW.system_key IS DISTINCT FROM OLD.system_key
        OR NEW.canonical_category_id IS DISTINCT FROM OLD.canonical_category_id
      ) THEN
      RAISE EXCEPTION 'Canonical categories cannot change their protected fields';
    END IF;

    IF NEW.system_key IS NULL OR btrim(NEW.system_key) = '' THEN
      RAISE EXCEPTION 'Canonical categories must define system_key';
    END IF;

    IF NOT (NEW.system_key = ANY (v_allowed_system_keys)) THEN
      RAISE EXCEPTION 'Canonical categories must use a shipped system_key';
    END IF;

    NEW.parent_id := NULL;
    NEW.depth := 1;
    NEW.canonical_category_id := NEW.id;
    NEW.created_by := NULL;
    RETURN NEW;
  END IF;

  NEW.system_key := NULL;

  IF NEW.canonical_category_id IS NULL OR NEW.canonical_category_id = NEW.id THEN
    RAISE EXCEPTION 'Custom categories must reference a canonical category';
  END IF;

  SELECT *
  INTO v_canonical
  FROM public.money_categories
  WHERE id = NEW.canonical_category_id;

  IF NOT FOUND OR v_canonical.category_kind <> 'canonical' THEN
    RAISE EXCEPTION 'Custom categories must reference a canonical category';
  END IF;

  IF NEW.parent_id = NEW.id THEN
    RAISE EXCEPTION 'Money categories cannot parent themselves';
  END IF;

  IF NEW.parent_id IS NULL THEN
    NEW.depth := 1;
  ELSE
    SELECT *
    INTO v_parent
    FROM public.money_categories
    WHERE id = NEW.parent_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Custom category parent does not exist';
    END IF;

    IF v_parent.category_kind = 'canonical' THEN
      IF v_parent.id <> NEW.canonical_category_id THEN
        RAISE EXCEPTION 'Custom category parent must stay within the same canonical branch';
      END IF;
    ELSIF v_parent.canonical_category_id <> NEW.canonical_category_id THEN
      RAISE EXCEPTION 'Custom category parent must stay within the same canonical branch';
    END IF;

    NEW.depth := v_parent.depth + 1;
  END IF;

  IF TG_OP = 'UPDATE'
    AND NEW.canonical_category_id IS DISTINCT FROM OLD.canonical_category_id
    AND EXISTS (
      WITH RECURSIVE descendants AS (
        SELECT child.id
        FROM public.money_categories AS child
        WHERE child.parent_id = OLD.id

        UNION ALL

        SELECT child.id
        FROM public.money_categories AS child
        JOIN descendants
          ON child.parent_id = descendants.id
      )
      SELECT 1 FROM descendants
    ) THEN
    RAISE EXCEPTION 'Cannot move a custom category with descendants to another canonical branch';
  END IF;

  IF TG_OP = 'UPDATE'
    AND OLD.category_kind = 'canonical'
    AND NEW.category_kind = 'canonical'
    AND NEW.id <> NEW.canonical_category_id THEN
    RAISE EXCEPTION 'Canonical categories must reference themselves as canonical root';
  END IF;

  IF NEW.depth < 1 OR NEW.depth > 4 THEN
    RAISE EXCEPTION 'Money category depth must stay between 1 and 4';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.money_categories_enforce_invariants() IS
  'Trigger function that enforces canonical/custom money category invariants and branch-safe nesting.';
