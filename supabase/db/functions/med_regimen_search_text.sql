-- Function: med_regimen_search_text(med_regimens)
-- The text a medication search matches: the course name and every active ingredient it names

-- A PostgREST computed field: taking the row type makes it filterable as if it were a column
-- (`?search_text=imatch.sertraline` on med_regimens), so the MCP `list_medications` search pages
-- and counts in the query instead of filtering a truncated response afterwards.
--
-- The ingredient names come from `dose_definition.unit_strength`, or from the legacy per-intake
-- `dose_definition.active` only when no per-unit ingredient is named -- the precedence every reader
-- applies (ADR-260907-cvj). A legacy total can outlive an edit of the per-unit strength, and
-- searching both would keep finding an ingredient the owner has replaced. Searched at all because
-- a course is named however the owner calls it -- «Золофт» -- while the question is often about
-- what it contains: «сертралин».
--
-- Each part sits on its own line, so a search cannot match across the end of one name and the
-- start of the next. Elements that are not objects, and arrays that are not arrays, are skipped:
-- the column is jsonb and an imported row is not held to the MCP schema.

CREATE OR REPLACE FUNCTION public.med_regimen_search_text(r public.med_regimens)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  WITH named AS (
    SELECT source, ingredient->>'name' AS name, ordinality
    FROM (
      SELECT 1 AS source, r.dose_definition->'unit_strength' AS list
      UNION ALL
      SELECT 2, r.dose_definition->'active'
    ) AS lists
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(lists.list) = 'array' THEN lists.list ELSE '[]'::jsonb END
    ) WITH ORDINALITY AS e(ingredient, ordinality)
    WHERE jsonb_typeof(ingredient) = 'object'
      AND nullif(btrim(ingredient->>'name'), '') IS NOT NULL
  )
  SELECT concat_ws(
    E'\n',
    r.custom_name,
    (
      SELECT string_agg(name, E'\n' ORDER BY ordinality)
      FROM named
      WHERE source = (SELECT min(source) FROM named)
    )
  );
$$;

REVOKE ALL ON FUNCTION public.med_regimen_search_text(public.med_regimens) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.med_regimen_search_text(public.med_regimens) TO authenticated;

COMMENT ON FUNCTION public.med_regimen_search_text(public.med_regimens) IS
  'Course name and active-ingredient names of a regimen, one per line, for name-or-ingredient search.';
