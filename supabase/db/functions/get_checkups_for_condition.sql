-- Function: get_checkups_for_condition()
-- Get checkup items linked to a condition via why_links

CREATE OR REPLACE FUNCTION public.get_checkups_for_condition(p_condition_id uuid)
RETURNS SETOF public.checkup_items
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT ci.*
  FROM public.checkup_items ci
  WHERE jsonb_path_exists(
    ci.why_links,
    '$[*] ? (@.type == "condition" && @.id == $cid)',
    jsonb_build_object('cid', to_jsonb(p_condition_id::text))
  )
  ORDER BY ci.next_due_at ASC NULLS LAST, ci.created_at DESC;
$$;

COMMENT ON FUNCTION public.get_checkups_for_condition(uuid) IS
  'Get checkup items that have a why_link to the given condition.';
