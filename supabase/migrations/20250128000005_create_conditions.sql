-- ============================================================================
-- CONDITIONS: Persistent diagnosis/condition entities per person
-- ============================================================================

CREATE TABLE public.conditions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id             uuid NOT NULL REFERENCES public.persons(id) ON DELETE CASCADE,
  
  -- Identity
  name                  text NOT NULL,
  normalized_name       text,                -- Will be renamed to icd_name_en in next migration
  code                  text,                -- ICD-10 code (e.g., "D50.9")
  
  -- Current state (reflects latest understanding)
  current_status        text NOT NULL DEFAULT 'suspected'
                        CHECK (current_status IN ('active', 'resolved', 'suspected', 'history')),
  
  -- Timeline
  onset_date            date,                -- When condition first appeared
  resolved_date         date,                -- When condition was resolved (if applicable)
  
  -- User notes (separate from record-specific notes)
  notes                 text,
  
  -- Timestamps
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz          -- Soft delete
);

-- Indexes
CREATE INDEX idx_conditions_person_id ON public.conditions(person_id);
CREATE INDEX idx_conditions_current_status ON public.conditions(current_status);
CREATE INDEX idx_conditions_deleted_at ON public.conditions(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_conditions_name_lower ON public.conditions(lower(name));

-- Trigger for updated_at
CREATE TRIGGER update_conditions_updated_at
  BEFORE UPDATE ON public.conditions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- CONDITION_RECORDS: Each mention of a condition in a medical record
-- ============================================================================

CREATE TABLE public.condition_records (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  condition_id          uuid NOT NULL REFERENCES public.conditions(id) ON DELETE CASCADE,
  record_id             uuid NOT NULL REFERENCES public.medical_records(id) ON DELETE CASCADE,
  
  -- Status as stated in THIS record (may differ from current_status)
  status_in_record      text NOT NULL
                        CHECK (status_in_record IN ('active', 'resolved', 'suspected', 'history')),
  
  -- Extraction metadata
  source_anchor         text,                -- Exact quote from document
  confidence            numeric CHECK (confidence >= 0 AND confidence <= 1),
  is_llm_extracted      boolean NOT NULL DEFAULT true,
  is_user_verified      boolean NOT NULL DEFAULT false,
  
  -- Timestamps
  created_at            timestamptz NOT NULL DEFAULT now(),
  
  -- Prevent duplicate mentions of same condition in same record
  UNIQUE(condition_id, record_id)
);

-- Indexes
CREATE INDEX idx_condition_records_condition_id ON public.condition_records(condition_id);
CREATE INDEX idx_condition_records_record_id ON public.condition_records(record_id);

-- ============================================================================
-- RLS POLICIES
-- ============================================================================

ALTER TABLE public.conditions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.condition_records ENABLE ROW LEVEL SECURITY;

-- Conditions: access via allowed_users
CREATE POLICY "Allowed users can read conditions"
  ON public.conditions FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.allowed_users au
    WHERE au.auth_user_id = auth.uid() OR au.email = auth.email()
  ));

CREATE POLICY "Allowed users can insert conditions"
  ON public.conditions FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.allowed_users au
    WHERE au.auth_user_id = auth.uid() OR au.email = auth.email()
  ));

CREATE POLICY "Allowed users can update conditions"
  ON public.conditions FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.allowed_users au
    WHERE au.auth_user_id = auth.uid() OR au.email = auth.email()
  ));

CREATE POLICY "Allowed users can delete conditions"
  ON public.conditions FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.allowed_users au
    WHERE au.auth_user_id = auth.uid() OR au.email = auth.email()
  ));

-- Condition records: access via parent condition
CREATE POLICY "Allowed users can read condition_records"
  ON public.condition_records FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.conditions c
    JOIN public.allowed_users au ON (au.auth_user_id = auth.uid() OR au.email = auth.email())
    WHERE c.id = condition_id
  ));

CREATE POLICY "Allowed users can insert condition_records"
  ON public.condition_records FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.conditions c
    JOIN public.allowed_users au ON (au.auth_user_id = auth.uid() OR au.email = auth.email())
    WHERE c.id = condition_id
  ));

CREATE POLICY "Allowed users can update condition_records"
  ON public.condition_records FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.conditions c
    JOIN public.allowed_users au ON (au.auth_user_id = auth.uid() OR au.email = auth.email())
    WHERE c.id = condition_id
  ));

CREATE POLICY "Allowed users can delete condition_records"
  ON public.condition_records FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.conditions c
    JOIN public.allowed_users au ON (au.auth_user_id = auth.uid() OR au.email = auth.email())
    WHERE c.id = condition_id
  ));

-- ============================================================================
-- HELPER FUNCTION: Get conditions for a record with their details
-- ============================================================================

CREATE OR REPLACE FUNCTION get_record_conditions(p_record_id uuid)
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
  -- From conditions table
  condition_name text,
  condition_normalized_name text,
  condition_code text,
  condition_current_status text,
  condition_onset_date date,
  condition_resolved_date date,
  condition_notes text
)
LANGUAGE sql STABLE
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
    c.normalized_name,
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

-- ============================================================================
-- HELPER FUNCTION: Get all conditions for a person with history
-- ============================================================================

CREATE OR REPLACE FUNCTION get_person_conditions_with_history(p_person_id uuid)
RETURNS TABLE (
  id uuid,
  person_id uuid,
  name text,
  normalized_name text,
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
LANGUAGE sql STABLE
AS $$
  SELECT 
    c.id,
    c.person_id,
    c.name,
    c.normalized_name,
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
