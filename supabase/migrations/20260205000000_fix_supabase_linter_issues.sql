-- Migration: Fix Supabase linter issues
-- Fixes: function_search_path_mutable, auth_rls_initplan, multiple_permissive_policies, rls_policy_always_true, rls_enabled_no_policy

-- =============================================================================
-- 1. DROP OLD DUPLICATE POLICIES FROM MIGRATIONS
-- =============================================================================

-- allowed_users
DROP POLICY IF EXISTS "Authenticated users can read allowed_users" ON public.allowed_users;

-- persons
DROP POLICY IF EXISTS "Allowed users can read all persons" ON public.persons;

-- medical_records
DROP POLICY IF EXISTS "Allowed users can read medical records" ON public.medical_records;
DROP POLICY IF EXISTS "Allowed users can insert medical records" ON public.medical_records;
DROP POLICY IF EXISTS "Allowed users can update medical records" ON public.medical_records;
DROP POLICY IF EXISTS "Allowed users can delete medical records" ON public.medical_records;

-- record_attachments
DROP POLICY IF EXISTS "Allowed users can read record attachments" ON public.record_attachments;
DROP POLICY IF EXISTS "Allowed users can insert record attachments" ON public.record_attachments;
DROP POLICY IF EXISTS "Allowed users can update record attachments" ON public.record_attachments;
DROP POLICY IF EXISTS "Allowed users can delete record attachments" ON public.record_attachments;

-- observation_catalog
DROP POLICY IF EXISTS "Authenticated users can read observation catalog" ON public.observation_catalog;
DROP POLICY IF EXISTS "Allowed users can insert observation catalog" ON public.observation_catalog;
DROP POLICY IF EXISTS "Allowed users can update observation catalog" ON public.observation_catalog;
DROP POLICY IF EXISTS "Allowed users can delete observation catalog" ON public.observation_catalog;

-- record_observations
DROP POLICY IF EXISTS "Users can read record observations" ON public.record_observations;
DROP POLICY IF EXISTS "Users can insert record observations" ON public.record_observations;
DROP POLICY IF EXISTS "Users can update record observations" ON public.record_observations;
DROP POLICY IF EXISTS "Users can delete record observations" ON public.record_observations;

-- measurement_catalog
DROP POLICY IF EXISTS "Authenticated users can read measurement catalog" ON public.measurement_catalog;
DROP POLICY IF EXISTS "Allowed users can insert measurement catalog" ON public.measurement_catalog;
DROP POLICY IF EXISTS "Allowed users can update measurement catalog" ON public.measurement_catalog;
DROP POLICY IF EXISTS "Allowed users can delete measurement catalog" ON public.measurement_catalog;

-- measurements
DROP POLICY IF EXISTS "Allowed users can read measurements" ON public.measurements;
DROP POLICY IF EXISTS "Allowed users can insert measurements" ON public.measurements;
DROP POLICY IF EXISTS "Allowed users can update measurements" ON public.measurements;
DROP POLICY IF EXISTS "Allowed users can delete measurements" ON public.measurements;

-- finding_type_catalog
DROP POLICY IF EXISTS "Authenticated users can read finding type catalog" ON public.finding_type_catalog;
DROP POLICY IF EXISTS "Authenticated users can insert finding types" ON public.finding_type_catalog;
DROP POLICY IF EXISTS "Authenticated users can update finding types" ON public.finding_type_catalog;
DROP POLICY IF EXISTS "Authenticated users can delete finding types" ON public.finding_type_catalog;

-- body_site_catalog
DROP POLICY IF EXISTS "Authenticated users can read body site catalog" ON public.body_site_catalog;
DROP POLICY IF EXISTS "Authenticated users can insert body sites" ON public.body_site_catalog;
DROP POLICY IF EXISTS "Authenticated users can update body sites" ON public.body_site_catalog;
DROP POLICY IF EXISTS "Authenticated users can delete body sites" ON public.body_site_catalog;

-- record_findings
DROP POLICY IF EXISTS "Users can read record findings" ON public.record_findings;
DROP POLICY IF EXISTS "Users can insert record findings" ON public.record_findings;
DROP POLICY IF EXISTS "Users can update record findings" ON public.record_findings;
DROP POLICY IF EXISTS "Users can delete record findings" ON public.record_findings;

-- conditions
DROP POLICY IF EXISTS "Allowed users can read conditions" ON public.conditions;
DROP POLICY IF EXISTS "Allowed users can insert conditions" ON public.conditions;
DROP POLICY IF EXISTS "Allowed users can update conditions" ON public.conditions;
DROP POLICY IF EXISTS "Allowed users can delete conditions" ON public.conditions;

-- condition_records
DROP POLICY IF EXISTS "Allowed users can read condition_records" ON public.condition_records;
DROP POLICY IF EXISTS "Allowed users can insert condition_records" ON public.condition_records;
DROP POLICY IF EXISTS "Allowed users can update condition_records" ON public.condition_records;
DROP POLICY IF EXISTS "Allowed users can delete condition_records" ON public.condition_records;

-- checkup_items
DROP POLICY IF EXISTS "Allowed users can read checkup_items" ON public.checkup_items;
DROP POLICY IF EXISTS "Allowed users can insert checkup_items" ON public.checkup_items;
DROP POLICY IF EXISTS "Allowed users can update checkup_items" ON public.checkup_items;
DROP POLICY IF EXISTS "Allowed users can delete checkup_items" ON public.checkup_items;

-- checkup_completions
DROP POLICY IF EXISTS "Allowed users can read checkup_completions" ON public.checkup_completions;
DROP POLICY IF EXISTS "Allowed users can insert checkup_completions" ON public.checkup_completions;
DROP POLICY IF EXISTS "Allowed users can update checkup_completions" ON public.checkup_completions;
DROP POLICY IF EXISTS "Allowed users can delete checkup_completions" ON public.checkup_completions;

-- user_preferences
DROP POLICY IF EXISTS "Users can read own user_preferences" ON public.user_preferences;
DROP POLICY IF EXISTS "Users can insert own user_preferences" ON public.user_preferences;
DROP POLICY IF EXISTS "Users can update own user_preferences" ON public.user_preferences;

-- push_subscriptions
DROP POLICY IF EXISTS "Users can read own push_subscriptions" ON public.push_subscriptions;
DROP POLICY IF EXISTS "Users can insert own push_subscriptions" ON public.push_subscriptions;
DROP POLICY IF EXISTS "Users can update own push_subscriptions" ON public.push_subscriptions;
DROP POLICY IF EXISTS "Users can delete own push_subscriptions" ON public.push_subscriptions;

-- notification_digests
DROP POLICY IF EXISTS "Users can read own notification_digests" ON public.notification_digests;
DROP POLICY IF EXISTS "Users can update own notification_digests (for mark-shown)" ON public.notification_digests;

-- notification_routing
DROP POLICY IF EXISTS "Users can read own notification_routing" ON public.notification_routing;
DROP POLICY IF EXISTS "Users can insert own notification_routing" ON public.notification_routing;
DROP POLICY IF EXISTS "Users can update own notification_routing" ON public.notification_routing;
DROP POLICY IF EXISTS "Users can delete own notification_routing" ON public.notification_routing;

-- med_regimens
DROP POLICY IF EXISTS "Allowed users can read med_regimens" ON public.med_regimens;
DROP POLICY IF EXISTS "Allowed users can insert med_regimens" ON public.med_regimens;
DROP POLICY IF EXISTS "Allowed users can update med_regimens" ON public.med_regimens;
DROP POLICY IF EXISTS "Allowed users can delete med_regimens" ON public.med_regimens;

-- med_dose_events
DROP POLICY IF EXISTS "Allowed users can read med_dose_events" ON public.med_dose_events;
DROP POLICY IF EXISTS "Allowed users can insert med_dose_events" ON public.med_dose_events;
DROP POLICY IF EXISTS "Allowed users can update med_dose_events" ON public.med_dose_events;
DROP POLICY IF EXISTS "Allowed users can delete med_dose_events" ON public.med_dose_events;

-- med_inventory_transactions
DROP POLICY IF EXISTS "Allowed users can read med_inventory_transactions" ON public.med_inventory_transactions;
DROP POLICY IF EXISTS "Allowed users can insert med_inventory_transactions" ON public.med_inventory_transactions;
DROP POLICY IF EXISTS "Allowed users can update med_inventory_transactions" ON public.med_inventory_transactions;
DROP POLICY IF EXISTS "Allowed users can delete med_inventory_transactions" ON public.med_inventory_transactions;

-- =============================================================================
-- 2. FIX db_deploy_log RLS (disable since it's admin-only)
-- Table is created by _version.sql on deploy, so it may not exist on db reset.
-- =============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'db_deploy_log') THEN
    ALTER TABLE public.db_deploy_log DISABLE ROW LEVEL SECURITY;
  END IF;
END $$;

-- =============================================================================
-- 3. UPDATE is_allowed_user FUNCTION (use select for auth functions)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.is_allowed_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.allowed_users au
    WHERE au.auth_user_id = (select auth.uid())
       OR au.email = (select auth.email())
  );
$$;

-- =============================================================================
-- 4. UPDATE TRIGGER FUNCTIONS (add search_path)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.checkup_completion_after_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  PERFORM public.checkup_recompute_next_due_for_item(NEW.checkup_item_id);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.checkup_completion_after_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  PERFORM public.checkup_recompute_next_due_for_item(OLD.checkup_item_id);
  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION public.checkup_completion_after_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  item_schedule jsonb;
  item_status text;
  item_next_due_at date;
  next_due date;
  base_date date;
  next_due_from text;
BEGIN
  SELECT schedule, status::text, next_due_at
  INTO item_schedule, item_status, item_next_due_at
  FROM public.checkup_items
  WHERE id = NEW.checkup_item_id;

  IF item_schedule IS NULL THEN
    RETURN NEW;
  END IF;

  IF (item_schedule->>'type') = 'one_off' THEN
    UPDATE public.checkup_items
    SET status = 'completed', updated_at = now()
    WHERE id = NEW.checkup_item_id;
    RETURN NEW;
  END IF;

  IF (item_schedule->>'type') = 'interval' AND item_status = 'active' THEN
    next_due_from := COALESCE(item_schedule->>'next_due_from', 'completion');
    IF next_due_from = 'target' AND item_next_due_at IS NOT NULL THEN
      base_date := item_next_due_at;
    ELSE
      base_date := NEW.done_at;
    END IF;
    next_due := public.checkup_compute_next_due(item_schedule, base_date);
    UPDATE public.checkup_items
    SET next_due_at = next_due, updated_at = now()
    WHERE id = NEW.checkup_item_id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.checkup_item_after_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.schedule IS DISTINCT FROM NEW.schedule THEN
    PERFORM public.checkup_recompute_next_due_for_item(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.checkup_item_set_next_due_on_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  s_type text;
  s_due_at text;
  base_date date;
BEGIN
  s_type := NEW.schedule->>'type';
  IF s_type = 'one_off' THEN
    s_due_at := NEW.schedule->>'due_at';
    IF s_due_at IS NOT NULL AND s_due_at != '' THEN
      NEW.next_due_at := s_due_at::date;
    ELSE
      NEW.next_due_at := NULL;
    END IF;
  ELSIF s_type = 'interval' THEN
    base_date := COALESCE(
      (NEW.schedule->>'anchor_date')::date,
      current_date
    );
    NEW.next_due_at := public.checkup_compute_next_due(NEW.schedule, base_date);
  ELSE
    NEW.next_due_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.checkup_compute_next_due(
  p_schedule jsonb,
  p_base_date date
)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  s_type text;
  s_every int;
  s_unit text;
  s_due_at text;
BEGIN
  s_type := p_schedule->>'type';
  IF s_type = 'one_off' THEN
    s_due_at := p_schedule->>'due_at';
    IF s_due_at IS NOT NULL AND s_due_at != '' THEN
      RETURN s_due_at::date;
    END IF;
    RETURN NULL;
  ELSIF s_type = 'interval' THEN
    s_every := (p_schedule->>'every')::int;
    s_unit := p_schedule->>'unit';
    IF s_every IS NULL OR s_every < 1 THEN
      RETURN NULL;
    END IF;
    IF s_unit = 'week' THEN
      RETURN p_base_date + (s_every || ' weeks')::interval;
    ELSIF s_unit = 'month' THEN
      RETURN p_base_date + (s_every || ' months')::interval;
    ELSIF s_unit = 'year' THEN
      RETURN p_base_date + (s_every || ' years')::interval;
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

-- =============================================================================
-- 5. UPDATE LOOKUP FUNCTIONS (add search_path)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.find_observation_by_synonym(
  p_text text,
  p_lang text DEFAULT 'en'
)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_normalized text;
  v_result text;
BEGIN
  v_normalized := lower(trim(p_text));
  
  IF p_lang = 'ru' THEN
    SELECT obs_code INTO v_result
    FROM public.observation_catalog
    WHERE v_normalized = ANY(synonyms_ru)
       OR lower(name_ru) = v_normalized
    LIMIT 1;
  ELSE
    SELECT obs_code INTO v_result
    FROM public.observation_catalog
    WHERE v_normalized = ANY(synonyms_en)
       OR lower(name_en) = v_normalized
    LIMIT 1;
  END IF;
  
  IF v_result IS NULL THEN
    IF p_lang = 'ru' THEN
      SELECT obs_code INTO v_result
      FROM public.observation_catalog
      WHERE v_normalized = ANY(synonyms_en)
         OR lower(name_en) = v_normalized
      LIMIT 1;
    ELSE
      SELECT obs_code INTO v_result
      FROM public.observation_catalog
      WHERE v_normalized = ANY(synonyms_ru)
         OR lower(name_ru) = v_normalized
      LIMIT 1;
    END IF;
  END IF;
  
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.convert_to_canonical_unit(
  p_obs_code text,
  p_value numeric,
  p_unit text
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_accepted_units jsonb;
  v_unit_config jsonb;
  v_factor numeric;
BEGIN
  SELECT accepted_units INTO v_accepted_units
  FROM public.observation_catalog
  WHERE obs_code = p_obs_code;
  
  IF v_accepted_units IS NULL THEN
    RAISE EXCEPTION 'Unknown observation code: %', p_obs_code;
  END IF;
  
  v_unit_config := v_accepted_units -> p_unit;
  
  IF v_unit_config IS NULL THEN
    RAISE EXCEPTION 'Unknown unit "%" for observation "%"', p_unit, p_obs_code;
  END IF;
  
  v_factor := (v_unit_config ->> 'factor_to_canonical')::numeric;
  
  IF v_factor IS NULL THEN
    RETURN NULL;
  END IF;
  
  RETURN p_value * v_factor;
END;
$$;

CREATE OR REPLACE FUNCTION public.find_finding_type_by_text(
  p_text text,
  p_lang text DEFAULT 'ru'
)
RETURNS TABLE (
  id uuid,
  finding_code text
)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_normalized text;
BEGIN
  v_normalized := lower(trim(p_text));
  
  RETURN QUERY
  SELECT ftc.id, ftc.finding_code
  FROM public.finding_type_catalog ftc
  WHERE 
    lower(ftc.finding_code) = v_normalized
    OR (p_lang = 'ru' AND (lower(ftc.name_ru) = v_normalized OR v_normalized = ANY(ftc.synonyms_ru)))
    OR (p_lang = 'en' AND (lower(ftc.name_en) = v_normalized OR v_normalized = ANY(ftc.synonyms_en)))
    OR lower(ftc.name_ru) = v_normalized
    OR lower(ftc.name_en) = v_normalized
    OR v_normalized = ANY(ftc.synonyms_ru)
    OR v_normalized = ANY(ftc.synonyms_en)
  LIMIT 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.find_body_site_by_text(
  p_text text,
  p_lang text DEFAULT 'ru'
)
RETURNS TABLE (
  id uuid,
  site_code text
)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_normalized text;
BEGIN
  v_normalized := lower(trim(p_text));
  
  RETURN QUERY
  SELECT bsc.id, bsc.site_code
  FROM public.body_site_catalog bsc
  WHERE 
    lower(bsc.site_code) = v_normalized
    OR (p_lang = 'ru' AND (lower(bsc.name_ru) = v_normalized OR v_normalized = ANY(bsc.synonyms_ru)))
    OR (p_lang = 'en' AND (lower(bsc.name_en) = v_normalized OR v_normalized = ANY(bsc.synonyms_en)))
    OR lower(bsc.name_ru) = v_normalized
    OR lower(bsc.name_en) = v_normalized
    OR v_normalized = ANY(bsc.synonyms_ru)
    OR v_normalized = ANY(bsc.synonyms_en)
  LIMIT 1;
END;
$$;

-- get_record_conditions (SQL function)
DROP FUNCTION IF EXISTS public.get_record_conditions(uuid);
CREATE OR REPLACE FUNCTION public.get_record_conditions(p_record_id uuid)
RETURNS TABLE (
  id uuid,
  condition_id uuid,
  record_id uuid,
  status_in_record text,
  source_anchor text,
  confidence numeric,
  is_llm_extracted boolean,
  is_user_verified boolean,
  created_at timestamptz,
  condition_name text,
  condition_icd_name_en text,
  condition_icd_name_ru text,
  condition_code text,
  condition_current_status text,
  condition_onset_date date,
  condition_resolved_date date,
  condition_notes text
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT 
    cr.id,
    cr.condition_id,
    cr.record_id,
    cr.status_in_record,
    cr.source_anchor,
    cr.confidence,
    cr.is_llm_extracted,
    cr.is_user_verified,
    cr.created_at,
    c.name,
    c.icd_name_en,
    c.icd_name_ru,
    c.code,
    c.current_status,
    c.onset_date,
    c.resolved_date,
    c.notes
  FROM public.condition_records cr
  JOIN public.conditions c ON c.id = cr.condition_id
  WHERE cr.record_id = p_record_id
    AND c.deleted_at IS NULL
  ORDER BY c.name;
$$;

-- get_person_conditions_with_history (SQL function)
DROP FUNCTION IF EXISTS public.get_person_conditions_with_history(uuid);
CREATE OR REPLACE FUNCTION public.get_person_conditions_with_history(p_person_id uuid)
RETURNS TABLE (
  id uuid,
  person_id uuid,
  name text,
  icd_name_en text,
  icd_name_ru text,
  code text,
  current_status text,
  onset_date date,
  resolved_date date,
  notes text,
  created_at timestamptz,
  updated_at timestamptz,
  mention_count bigint,
  first_mentioned_date date,
  last_mentioned_date date
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT 
    c.id,
    c.person_id,
    c.name,
    c.icd_name_en,
    c.icd_name_ru,
    c.code,
    c.current_status,
    c.onset_date,
    c.resolved_date,
    c.notes,
    c.created_at,
    c.updated_at,
    COUNT(cr.id) as mention_count,
    MIN(mr.record_date) as first_mentioned_date,
    MAX(mr.record_date) as last_mentioned_date
  FROM public.conditions c
  LEFT JOIN public.condition_records cr ON cr.condition_id = c.id
  LEFT JOIN public.medical_records mr ON mr.id = cr.record_id
  WHERE c.person_id = p_person_id
    AND c.deleted_at IS NULL
  GROUP BY c.id
  ORDER BY c.current_status, c.name;
$$;

-- =============================================================================
-- 6. RECREATE POLICIES WITH (select auth.uid()) PATTERN
-- =============================================================================

-- allowed_users
DROP POLICY IF EXISTS "allowed_users_select" ON public.allowed_users;
CREATE POLICY "allowed_users_select" ON public.allowed_users
  FOR SELECT TO authenticated
  USING (true);

-- persons
DROP POLICY IF EXISTS "persons_select" ON public.persons;
CREATE POLICY "persons_select" ON public.persons
  FOR SELECT TO authenticated
  USING ((select public.is_allowed_user()));

-- medical_records
DROP POLICY IF EXISTS "medical_records_select" ON public.medical_records;
CREATE POLICY "medical_records_select" ON public.medical_records
  FOR SELECT TO authenticated
  USING ((select public.is_allowed_user()));

DROP POLICY IF EXISTS "medical_records_insert" ON public.medical_records;
CREATE POLICY "medical_records_insert" ON public.medical_records
  FOR INSERT TO authenticated
  WITH CHECK (
    (select public.is_allowed_user())
    AND created_by_user_id = (select auth.uid())
  );

DROP POLICY IF EXISTS "medical_records_update" ON public.medical_records;
CREATE POLICY "medical_records_update" ON public.medical_records
  FOR UPDATE TO authenticated
  USING ((select public.is_allowed_user()))
  WITH CHECK ((select public.is_allowed_user()));

DROP POLICY IF EXISTS "medical_records_delete" ON public.medical_records;
CREATE POLICY "medical_records_delete" ON public.medical_records
  FOR DELETE TO authenticated
  USING ((select public.is_allowed_user()));

-- record_attachments
DROP POLICY IF EXISTS "record_attachments_select" ON public.record_attachments;
CREATE POLICY "record_attachments_select" ON public.record_attachments
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.medical_records mr WHERE mr.id = record_id)
    AND (select public.is_allowed_user())
  );

DROP POLICY IF EXISTS "record_attachments_insert" ON public.record_attachments;
CREATE POLICY "record_attachments_insert" ON public.record_attachments
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.medical_records mr WHERE mr.id = record_id)
    AND (select public.is_allowed_user())
  );

DROP POLICY IF EXISTS "record_attachments_update" ON public.record_attachments;
CREATE POLICY "record_attachments_update" ON public.record_attachments
  FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.medical_records mr WHERE mr.id = record_id)
    AND (select public.is_allowed_user())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.medical_records mr WHERE mr.id = record_id)
    AND (select public.is_allowed_user())
  );

DROP POLICY IF EXISTS "record_attachments_delete" ON public.record_attachments;
CREATE POLICY "record_attachments_delete" ON public.record_attachments
  FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.medical_records mr WHERE mr.id = record_id)
    AND (select public.is_allowed_user())
  );

-- observation_catalog
DROP POLICY IF EXISTS "observation_catalog_select" ON public.observation_catalog;
CREATE POLICY "observation_catalog_select" ON public.observation_catalog
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "observation_catalog_insert" ON public.observation_catalog;
CREATE POLICY "observation_catalog_insert" ON public.observation_catalog
  FOR INSERT TO authenticated
  WITH CHECK ((select public.is_allowed_user()));

DROP POLICY IF EXISTS "observation_catalog_update" ON public.observation_catalog;
CREATE POLICY "observation_catalog_update" ON public.observation_catalog
  FOR UPDATE TO authenticated
  USING ((select public.is_allowed_user()));

DROP POLICY IF EXISTS "observation_catalog_delete" ON public.observation_catalog;
CREATE POLICY "observation_catalog_delete" ON public.observation_catalog
  FOR DELETE TO authenticated
  USING ((select public.is_allowed_user()));

-- record_observations
DROP POLICY IF EXISTS "record_observations_select" ON public.record_observations;
CREATE POLICY "record_observations_select" ON public.record_observations
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.medical_records mr WHERE mr.id = record_id)
    AND (select public.is_allowed_user())
  );

DROP POLICY IF EXISTS "record_observations_insert" ON public.record_observations;
CREATE POLICY "record_observations_insert" ON public.record_observations
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.medical_records mr WHERE mr.id = record_id)
    AND (select public.is_allowed_user())
  );

DROP POLICY IF EXISTS "record_observations_update" ON public.record_observations;
CREATE POLICY "record_observations_update" ON public.record_observations
  FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.medical_records mr WHERE mr.id = record_id)
    AND (select public.is_allowed_user())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.medical_records mr WHERE mr.id = record_id)
    AND (select public.is_allowed_user())
  );

DROP POLICY IF EXISTS "record_observations_delete" ON public.record_observations;
CREATE POLICY "record_observations_delete" ON public.record_observations
  FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.medical_records mr WHERE mr.id = record_id)
    AND (select public.is_allowed_user())
  );

-- measurement_catalog
DROP POLICY IF EXISTS "measurement_catalog_select" ON public.measurement_catalog;
CREATE POLICY "measurement_catalog_select" ON public.measurement_catalog
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "measurement_catalog_insert" ON public.measurement_catalog;
CREATE POLICY "measurement_catalog_insert" ON public.measurement_catalog
  FOR INSERT TO authenticated
  WITH CHECK ((select public.is_allowed_user()));

DROP POLICY IF EXISTS "measurement_catalog_update" ON public.measurement_catalog;
CREATE POLICY "measurement_catalog_update" ON public.measurement_catalog
  FOR UPDATE TO authenticated
  USING ((select public.is_allowed_user()));

DROP POLICY IF EXISTS "measurement_catalog_delete" ON public.measurement_catalog;
CREATE POLICY "measurement_catalog_delete" ON public.measurement_catalog
  FOR DELETE TO authenticated
  USING ((select public.is_allowed_user()));

-- measurements
DROP POLICY IF EXISTS "measurements_select" ON public.measurements;
CREATE POLICY "measurements_select" ON public.measurements
  FOR SELECT TO authenticated
  USING ((select public.is_allowed_user()));

DROP POLICY IF EXISTS "measurements_insert" ON public.measurements;
CREATE POLICY "measurements_insert" ON public.measurements
  FOR INSERT TO authenticated
  WITH CHECK ((select public.is_allowed_user()));

DROP POLICY IF EXISTS "measurements_update" ON public.measurements;
CREATE POLICY "measurements_update" ON public.measurements
  FOR UPDATE TO authenticated
  USING ((select public.is_allowed_user()));

DROP POLICY IF EXISTS "measurements_delete" ON public.measurements;
CREATE POLICY "measurements_delete" ON public.measurements
  FOR DELETE TO authenticated
  USING ((select public.is_allowed_user()));

-- finding_type_catalog
DROP POLICY IF EXISTS "finding_type_catalog_select" ON public.finding_type_catalog;
CREATE POLICY "finding_type_catalog_select" ON public.finding_type_catalog
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "finding_type_catalog_insert" ON public.finding_type_catalog;
CREATE POLICY "finding_type_catalog_insert" ON public.finding_type_catalog
  FOR INSERT TO authenticated
  WITH CHECK ((select public.is_allowed_user()));

DROP POLICY IF EXISTS "finding_type_catalog_update" ON public.finding_type_catalog;
CREATE POLICY "finding_type_catalog_update" ON public.finding_type_catalog
  FOR UPDATE TO authenticated
  USING ((select public.is_allowed_user()));

DROP POLICY IF EXISTS "finding_type_catalog_delete" ON public.finding_type_catalog;
CREATE POLICY "finding_type_catalog_delete" ON public.finding_type_catalog
  FOR DELETE TO authenticated
  USING ((select public.is_allowed_user()));

-- body_site_catalog
DROP POLICY IF EXISTS "body_site_catalog_select" ON public.body_site_catalog;
CREATE POLICY "body_site_catalog_select" ON public.body_site_catalog
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "body_site_catalog_insert" ON public.body_site_catalog;
CREATE POLICY "body_site_catalog_insert" ON public.body_site_catalog
  FOR INSERT TO authenticated
  WITH CHECK ((select public.is_allowed_user()));

DROP POLICY IF EXISTS "body_site_catalog_update" ON public.body_site_catalog;
CREATE POLICY "body_site_catalog_update" ON public.body_site_catalog
  FOR UPDATE TO authenticated
  USING ((select public.is_allowed_user()));

DROP POLICY IF EXISTS "body_site_catalog_delete" ON public.body_site_catalog;
CREATE POLICY "body_site_catalog_delete" ON public.body_site_catalog
  FOR DELETE TO authenticated
  USING ((select public.is_allowed_user()));

-- record_findings
DROP POLICY IF EXISTS "record_findings_select" ON public.record_findings;
CREATE POLICY "record_findings_select" ON public.record_findings
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.medical_records mr WHERE mr.id = record_id)
    AND (select public.is_allowed_user())
  );

DROP POLICY IF EXISTS "record_findings_insert" ON public.record_findings;
CREATE POLICY "record_findings_insert" ON public.record_findings
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.medical_records mr WHERE mr.id = record_id)
    AND (select public.is_allowed_user())
  );

DROP POLICY IF EXISTS "record_findings_update" ON public.record_findings;
CREATE POLICY "record_findings_update" ON public.record_findings
  FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.medical_records mr WHERE mr.id = record_id)
    AND (select public.is_allowed_user())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.medical_records mr WHERE mr.id = record_id)
    AND (select public.is_allowed_user())
  );

DROP POLICY IF EXISTS "record_findings_delete" ON public.record_findings;
CREATE POLICY "record_findings_delete" ON public.record_findings
  FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.medical_records mr WHERE mr.id = record_id)
    AND (select public.is_allowed_user())
  );

-- conditions
DROP POLICY IF EXISTS "conditions_select" ON public.conditions;
CREATE POLICY "conditions_select" ON public.conditions
  FOR SELECT TO authenticated
  USING ((select public.is_allowed_user()));

DROP POLICY IF EXISTS "conditions_insert" ON public.conditions;
CREATE POLICY "conditions_insert" ON public.conditions
  FOR INSERT TO authenticated
  WITH CHECK ((select public.is_allowed_user()));

DROP POLICY IF EXISTS "conditions_update" ON public.conditions;
CREATE POLICY "conditions_update" ON public.conditions
  FOR UPDATE TO authenticated
  USING ((select public.is_allowed_user()));

DROP POLICY IF EXISTS "conditions_delete" ON public.conditions;
CREATE POLICY "conditions_delete" ON public.conditions
  FOR DELETE TO authenticated
  USING ((select public.is_allowed_user()));

-- condition_records
DROP POLICY IF EXISTS "condition_records_select" ON public.condition_records;
CREATE POLICY "condition_records_select" ON public.condition_records
  FOR SELECT TO authenticated
  USING ((select public.is_allowed_user()));

DROP POLICY IF EXISTS "condition_records_insert" ON public.condition_records;
CREATE POLICY "condition_records_insert" ON public.condition_records
  FOR INSERT TO authenticated
  WITH CHECK ((select public.is_allowed_user()));

DROP POLICY IF EXISTS "condition_records_update" ON public.condition_records;
CREATE POLICY "condition_records_update" ON public.condition_records
  FOR UPDATE TO authenticated
  USING ((select public.is_allowed_user()));

DROP POLICY IF EXISTS "condition_records_delete" ON public.condition_records;
CREATE POLICY "condition_records_delete" ON public.condition_records
  FOR DELETE TO authenticated
  USING ((select public.is_allowed_user()));

-- checkup_items
DROP POLICY IF EXISTS "checkup_items_select" ON public.checkup_items;
CREATE POLICY "checkup_items_select" ON public.checkup_items
  FOR SELECT TO authenticated
  USING ((select public.is_allowed_user()));

DROP POLICY IF EXISTS "checkup_items_insert" ON public.checkup_items;
CREATE POLICY "checkup_items_insert" ON public.checkup_items
  FOR INSERT TO authenticated
  WITH CHECK ((select public.is_allowed_user()));

DROP POLICY IF EXISTS "checkup_items_update" ON public.checkup_items;
CREATE POLICY "checkup_items_update" ON public.checkup_items
  FOR UPDATE TO authenticated
  USING ((select public.is_allowed_user()));

DROP POLICY IF EXISTS "checkup_items_delete" ON public.checkup_items;
CREATE POLICY "checkup_items_delete" ON public.checkup_items
  FOR DELETE TO authenticated
  USING ((select public.is_allowed_user()));

-- checkup_completions
DROP POLICY IF EXISTS "checkup_completions_select" ON public.checkup_completions;
CREATE POLICY "checkup_completions_select" ON public.checkup_completions
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.checkup_items ci WHERE ci.id = checkup_item_id)
    AND (select public.is_allowed_user())
  );

DROP POLICY IF EXISTS "checkup_completions_insert" ON public.checkup_completions;
CREATE POLICY "checkup_completions_insert" ON public.checkup_completions
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.checkup_items ci WHERE ci.id = checkup_item_id)
    AND (select public.is_allowed_user())
  );

DROP POLICY IF EXISTS "checkup_completions_update" ON public.checkup_completions;
CREATE POLICY "checkup_completions_update" ON public.checkup_completions
  FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.checkup_items ci WHERE ci.id = checkup_item_id)
    AND (select public.is_allowed_user())
  );

DROP POLICY IF EXISTS "checkup_completions_delete" ON public.checkup_completions;
CREATE POLICY "checkup_completions_delete" ON public.checkup_completions
  FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.checkup_items ci WHERE ci.id = checkup_item_id)
    AND (select public.is_allowed_user())
  );

-- user_preferences
DROP POLICY IF EXISTS "user_preferences_select" ON public.user_preferences;
CREATE POLICY "user_preferences_select" ON public.user_preferences
  FOR SELECT TO authenticated
  USING (auth_user_id = (select auth.uid()));

DROP POLICY IF EXISTS "user_preferences_insert" ON public.user_preferences;
CREATE POLICY "user_preferences_insert" ON public.user_preferences
  FOR INSERT TO authenticated
  WITH CHECK (auth_user_id = (select auth.uid()));

DROP POLICY IF EXISTS "user_preferences_update" ON public.user_preferences;
CREATE POLICY "user_preferences_update" ON public.user_preferences
  FOR UPDATE TO authenticated
  USING (auth_user_id = (select auth.uid()))
  WITH CHECK (auth_user_id = (select auth.uid()));

-- push_subscriptions
DROP POLICY IF EXISTS "push_subscriptions_select" ON public.push_subscriptions;
CREATE POLICY "push_subscriptions_select" ON public.push_subscriptions
  FOR SELECT TO authenticated
  USING (auth_user_id = (select auth.uid()));

DROP POLICY IF EXISTS "push_subscriptions_insert" ON public.push_subscriptions;
CREATE POLICY "push_subscriptions_insert" ON public.push_subscriptions
  FOR INSERT TO authenticated
  WITH CHECK (auth_user_id = (select auth.uid()));

DROP POLICY IF EXISTS "push_subscriptions_update" ON public.push_subscriptions;
CREATE POLICY "push_subscriptions_update" ON public.push_subscriptions
  FOR UPDATE TO authenticated
  USING (auth_user_id = (select auth.uid()))
  WITH CHECK (auth_user_id = (select auth.uid()));

DROP POLICY IF EXISTS "push_subscriptions_delete" ON public.push_subscriptions;
CREATE POLICY "push_subscriptions_delete" ON public.push_subscriptions
  FOR DELETE TO authenticated
  USING (auth_user_id = (select auth.uid()));

-- notification_digests
DROP POLICY IF EXISTS "notification_digests_select" ON public.notification_digests;
CREATE POLICY "notification_digests_select" ON public.notification_digests
  FOR SELECT TO authenticated
  USING (auth_user_id = (select auth.uid()));

DROP POLICY IF EXISTS "notification_digests_update" ON public.notification_digests;
CREATE POLICY "notification_digests_update" ON public.notification_digests
  FOR UPDATE TO authenticated
  USING (auth_user_id = (select auth.uid()))
  WITH CHECK (auth_user_id = (select auth.uid()));

-- notification_routing
DROP POLICY IF EXISTS "notification_routing_select" ON public.notification_routing;
CREATE POLICY "notification_routing_select" ON public.notification_routing
  FOR SELECT TO authenticated
  USING (recipient_user_id = (select auth.uid()));

DROP POLICY IF EXISTS "notification_routing_insert" ON public.notification_routing;
CREATE POLICY "notification_routing_insert" ON public.notification_routing
  FOR INSERT TO authenticated
  WITH CHECK (recipient_user_id = (select auth.uid()));

DROP POLICY IF EXISTS "notification_routing_update" ON public.notification_routing;
CREATE POLICY "notification_routing_update" ON public.notification_routing
  FOR UPDATE TO authenticated
  USING (recipient_user_id = (select auth.uid()))
  WITH CHECK (recipient_user_id = (select auth.uid()));

DROP POLICY IF EXISTS "notification_routing_delete" ON public.notification_routing;
CREATE POLICY "notification_routing_delete" ON public.notification_routing
  FOR DELETE TO authenticated
  USING (recipient_user_id = (select auth.uid()));

-- med_regimens
DROP POLICY IF EXISTS "med_regimens_select" ON public.med_regimens;
CREATE POLICY "med_regimens_select" ON public.med_regimens
  FOR SELECT TO authenticated
  USING ((select public.is_allowed_user()));

DROP POLICY IF EXISTS "med_regimens_insert" ON public.med_regimens;
CREATE POLICY "med_regimens_insert" ON public.med_regimens
  FOR INSERT TO authenticated
  WITH CHECK ((select public.is_allowed_user()));

DROP POLICY IF EXISTS "med_regimens_update" ON public.med_regimens;
CREATE POLICY "med_regimens_update" ON public.med_regimens
  FOR UPDATE TO authenticated
  USING ((select public.is_allowed_user()));

DROP POLICY IF EXISTS "med_regimens_delete" ON public.med_regimens;
CREATE POLICY "med_regimens_delete" ON public.med_regimens
  FOR DELETE TO authenticated
  USING ((select public.is_allowed_user()));

-- med_dose_events
DROP POLICY IF EXISTS "med_dose_events_select" ON public.med_dose_events;
CREATE POLICY "med_dose_events_select" ON public.med_dose_events
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.med_regimens r WHERE r.id = regimen_id)
    AND (select public.is_allowed_user())
  );

DROP POLICY IF EXISTS "med_dose_events_insert" ON public.med_dose_events;
CREATE POLICY "med_dose_events_insert" ON public.med_dose_events
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.med_regimens r WHERE r.id = regimen_id)
    AND (select public.is_allowed_user())
  );

DROP POLICY IF EXISTS "med_dose_events_update" ON public.med_dose_events;
CREATE POLICY "med_dose_events_update" ON public.med_dose_events
  FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.med_regimens r WHERE r.id = regimen_id)
    AND (select public.is_allowed_user())
  );

DROP POLICY IF EXISTS "med_dose_events_delete" ON public.med_dose_events;
CREATE POLICY "med_dose_events_delete" ON public.med_dose_events
  FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.med_regimens r WHERE r.id = regimen_id)
    AND (select public.is_allowed_user())
  );

-- med_inventory_transactions
DROP POLICY IF EXISTS "med_inventory_transactions_select" ON public.med_inventory_transactions;
CREATE POLICY "med_inventory_transactions_select" ON public.med_inventory_transactions
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.med_regimens r WHERE r.id = regimen_id)
    AND (select public.is_allowed_user())
  );

DROP POLICY IF EXISTS "med_inventory_transactions_insert" ON public.med_inventory_transactions;
CREATE POLICY "med_inventory_transactions_insert" ON public.med_inventory_transactions
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.med_regimens r WHERE r.id = regimen_id)
    AND (select public.is_allowed_user())
  );

DROP POLICY IF EXISTS "med_inventory_transactions_update" ON public.med_inventory_transactions;
CREATE POLICY "med_inventory_transactions_update" ON public.med_inventory_transactions
  FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.med_regimens r WHERE r.id = regimen_id)
    AND (select public.is_allowed_user())
  );

DROP POLICY IF EXISTS "med_inventory_transactions_delete" ON public.med_inventory_transactions;
CREATE POLICY "med_inventory_transactions_delete" ON public.med_inventory_transactions
  FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.med_regimens r WHERE r.id = regimen_id)
    AND (select public.is_allowed_user())
  );

-- =============================================================================
-- END OF MIGRATION
-- =============================================================================
