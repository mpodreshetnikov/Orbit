-- Function: money_budget_targets_enforce_invariants()
-- Prevents overlapping targets in the same display branch and keeps month_start normalized.

CREATE OR REPLACE FUNCTION public.money_budget_targets_enforce_invariants()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_conflict_category_id uuid;
BEGIN
  IF NEW.month_start IS NULL THEN
    RAISE EXCEPTION 'Budget targets require month_start';
  END IF;

  NEW.month_start := date_trunc('month', NEW.month_start)::date;
  NEW.currency := upper(NEW.currency);

  WITH RECURSIVE category_graph AS (
    SELECT
      c.id,
      CASE
        WHEN c.parent_id IS NOT NULL THEN c.parent_id
        WHEN c.category_kind = 'custom' AND c.canonical_category_id <> c.id THEN c.canonical_category_id
        ELSE NULL
      END AS display_parent_id
    FROM public.money_categories AS c
  ),
  ancestors AS (
    SELECT graph.display_parent_id AS category_id
    FROM category_graph AS graph
    WHERE graph.id = NEW.category_id
      AND graph.display_parent_id IS NOT NULL

    UNION ALL

    SELECT graph.display_parent_id
    FROM category_graph AS graph
    JOIN ancestors
      ON graph.id = ancestors.category_id
    WHERE graph.display_parent_id IS NOT NULL
  ),
  descendants AS (
    SELECT graph.id AS category_id
    FROM category_graph AS graph
    WHERE graph.display_parent_id = NEW.category_id

    UNION ALL

    SELECT graph.id
    FROM category_graph AS graph
    JOIN descendants
      ON graph.display_parent_id = descendants.category_id
  )
  SELECT existing.category_id
  INTO v_conflict_category_id
  FROM public.money_budget_targets AS existing
  WHERE existing.person_id = NEW.person_id
    AND existing.month_start = NEW.month_start
    AND existing.id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
    AND (
      existing.category_id IN (SELECT category_id FROM ancestors)
      OR existing.category_id IN (SELECT category_id FROM descendants)
    )
  LIMIT 1;

  IF v_conflict_category_id IS NOT NULL THEN
    RAISE EXCEPTION 'Budget targets cannot overlap across ancestor or descendant categories in the same month';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.money_budget_targets_enforce_invariants() IS
  'Trigger function that normalizes budget targets and blocks ancestor or descendant overlap within the same person and month.';
