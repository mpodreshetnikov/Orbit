-- Function: med_regimen_search_text(med_regimens)
-- The text a medication search matches: the course name and every active ingredient it names

-- A PostgREST computed field: taking the row type makes it filterable as if it were a column
-- (`?search_text=imatch.sertraline` on med_regimens), so the MCP `list_medications` search pages
-- and counts in the query instead of filtering a truncated response afterwards.
--
-- The ingredient names come from `dose_definition.unit_strength` and from the legacy per-intake
-- `dose_definition.active` (ADR-260907-cvj), because a course is named however the owner calls it
-- -- «Золофт» -- while the question is often about what it contains: «сертралин».
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
  SELECT concat_ws(
    E'\n',
    r.custom_name,
    (
      SELECT string_agg(ingredient->>'name', E'\n')
      FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(r.dose_definition->'unit_strength') = 'array'
          THEN r.dose_definition->'unit_strength' ELSE '[]'::jsonb END
        || CASE WHEN jsonb_typeof(r.dose_definition->'active') = 'array'
          THEN r.dose_definition->'active' ELSE '[]'::jsonb END
      ) AS ingredient
      WHERE jsonb_typeof(ingredient) = 'object'
        AND nullif(btrim(ingredient->>'name'), '') IS NOT NULL
    )
  );
$$;

REVOKE ALL ON FUNCTION public.med_regimen_search_text(public.med_regimens) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.med_regimen_search_text(public.med_regimens) TO authenticated;

COMMENT ON FUNCTION public.med_regimen_search_text(public.med_regimens) IS
  'Course name and active-ingredient names of a regimen, one per line, for name-or-ingredient search.';
