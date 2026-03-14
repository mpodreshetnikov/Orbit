-- Function: money_person_self_transfer_variants(uuid)
-- Builds deterministic normalized variants from the person's name for self-transfer matching.

CREATE OR REPLACE FUNCTION public.money_person_self_transfer_variants(p_person_id uuid)
RETURNS TABLE (normalized_alias text)
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_name text;
  v_clean_name text;
  v_tokens text[];
  v_token_count int;
  v_head text;
  v_first_initial text;
  v_all_initials text;
  v_seen text[] := ARRAY[]::text[];
  v_variant text;
BEGIN
  SELECT p.name
  INTO v_name
  FROM public.persons AS p
  WHERE p.id = p_person_id;

  IF v_name IS NULL THEN
    RETURN;
  END IF;

  v_clean_name := regexp_replace(
    replace(lower(btrim(v_name)), 'ё', 'е'),
    '[^a-z0-9а-я]+',
    ' ',
    'g'
  );
  v_clean_name := NULLIF(regexp_replace(v_clean_name, '\s+', ' ', 'g'), '');

  IF v_clean_name IS NULL THEN
    RETURN;
  END IF;

  v_tokens := regexp_split_to_array(v_clean_name, '\s+');
  v_token_count := COALESCE(array_length(v_tokens, 1), 0);

  IF v_token_count = 0 THEN
    RETURN;
  END IF;

  v_variant := array_to_string(v_tokens, '');
  IF v_variant <> '' THEN
    v_seen := array_append(v_seen, v_variant);
    normalized_alias := v_variant;
    RETURN NEXT;
  END IF;

  FOR token_index IN 1..v_token_count LOOP
    v_head := v_tokens[token_index];
    IF v_head IS NULL OR v_head = '' THEN
      CONTINUE;
    END IF;

    v_first_initial := NULL;
    v_all_initials := '';

    FOR other_index IN 1..v_token_count LOOP
      IF other_index = token_index OR v_tokens[other_index] IS NULL OR v_tokens[other_index] = '' THEN
        CONTINUE;
      END IF;

      IF v_first_initial IS NULL THEN
        v_first_initial := left(v_tokens[other_index], 1);
      END IF;

      v_all_initials := v_all_initials || left(v_tokens[other_index], 1);
    END LOOP;

    IF v_first_initial IS NOT NULL THEN
      v_variant := v_head || v_first_initial;
      IF NOT (v_variant = ANY(v_seen)) THEN
        v_seen := array_append(v_seen, v_variant);
        normalized_alias := v_variant;
        RETURN NEXT;
      END IF;
    END IF;

    IF v_all_initials <> '' THEN
      v_variant := v_head || v_all_initials;
      IF NOT (v_variant = ANY(v_seen)) THEN
        v_seen := array_append(v_seen, v_variant);
        normalized_alias := v_variant;
        RETURN NEXT;
      END IF;
    END IF;
  END LOOP;

  RETURN;
END;
$$;

COMMENT ON FUNCTION public.money_person_self_transfer_variants(uuid) IS
  'Returns deterministic normalized self-transfer match variants derived from a person''s stored name.';
