-- ============================================================================
-- CHECKUPS & FOLLOW-UPS: Enums and tables per PRD (no checkup_plans)
-- ============================================================================

-- Enums
CREATE TYPE public.checkup_category AS ENUM (
  'lab',
  'imaging',
  'visit',
  'vaccination',
  'dental',
  'other'
);

CREATE TYPE public.checkup_item_status AS ENUM (
  'active',
  'paused',
  'completed',
  'archived'
);

-- ============================================================================
-- TABLE: checkup_items
-- ============================================================================

CREATE TABLE public.checkup_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id       uuid NOT NULL REFERENCES public.persons(id) ON DELETE CASCADE,

  title           text NOT NULL,
  category        public.checkup_category NOT NULL,
  schedule        jsonb NOT NULL,
  next_due_at     date,
  status          public.checkup_item_status NOT NULL DEFAULT 'active',

  why_text        text,
  why_links       jsonb DEFAULT '[]'::jsonb,
  notes           text,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_checkup_items_person_id ON public.checkup_items(person_id);
CREATE INDEX idx_checkup_items_status ON public.checkup_items(status);
CREATE INDEX idx_checkup_items_next_due_at ON public.checkup_items(next_due_at);
CREATE INDEX idx_checkup_items_category ON public.checkup_items(category);
CREATE INDEX idx_checkup_items_why_links ON public.checkup_items USING GIN (why_links jsonb_path_ops);

CREATE TRIGGER update_checkup_items_updated_at
  BEFORE UPDATE ON public.checkup_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================================
-- TABLE: checkup_completions
-- ============================================================================

CREATE TABLE public.checkup_completions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checkup_item_id     uuid NOT NULL REFERENCES public.checkup_items(id) ON DELETE CASCADE,
  done_at             date NOT NULL,
  note                text,
  evidence_record_id  uuid REFERENCES public.medical_records(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_checkup_completions_checkup_item_id ON public.checkup_completions(checkup_item_id);
CREATE INDEX idx_checkup_completions_done_at ON public.checkup_completions(done_at);

-- ============================================================================
-- RLS
-- ============================================================================

ALTER TABLE public.checkup_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checkup_completions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allowed users can read checkup_items"
  ON public.checkup_items FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.allowed_users au
    WHERE au.auth_user_id = auth.uid() OR au.email = auth.email()
  ));

CREATE POLICY "Allowed users can insert checkup_items"
  ON public.checkup_items FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.allowed_users au
    WHERE au.auth_user_id = auth.uid() OR au.email = auth.email()
  ));

CREATE POLICY "Allowed users can update checkup_items"
  ON public.checkup_items FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.allowed_users au
    WHERE au.auth_user_id = auth.uid() OR au.email = auth.email()
  ));

CREATE POLICY "Allowed users can delete checkup_items"
  ON public.checkup_items FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.allowed_users au
    WHERE au.auth_user_id = auth.uid() OR au.email = auth.email()
  ));

CREATE POLICY "Allowed users can read checkup_completions"
  ON public.checkup_completions FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.checkup_items ci
    JOIN public.allowed_users au ON (au.auth_user_id = auth.uid() OR au.email = auth.email())
    WHERE ci.id = checkup_item_id
  ));

CREATE POLICY "Allowed users can insert checkup_completions"
  ON public.checkup_completions FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.checkup_items ci
    JOIN public.allowed_users au ON (au.auth_user_id = auth.uid() OR au.email = auth.email())
    WHERE ci.id = checkup_item_id
  ));

CREATE POLICY "Allowed users can update checkup_completions"
  ON public.checkup_completions FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.checkup_items ci
    JOIN public.allowed_users au ON (au.auth_user_id = auth.uid() OR au.email = auth.email())
    WHERE ci.id = checkup_item_id
  ));

CREATE POLICY "Allowed users can delete checkup_completions"
  ON public.checkup_completions FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.checkup_items ci
    JOIN public.allowed_users au ON (au.auth_user_id = auth.uid() OR au.email = auth.email())
    WHERE ci.id = checkup_item_id
  ));

-- ============================================================================
-- SCHEDULING: Compute next_due_at from schedule + base date
-- ============================================================================

CREATE OR REPLACE FUNCTION public.checkup_compute_next_due(
  p_schedule jsonb,
  p_base_date date
)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
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

-- ============================================================================
-- TRIGGER: On INSERT checkup_items — set next_due_at from schedule
-- ============================================================================

CREATE OR REPLACE FUNCTION public.checkup_item_set_next_due_on_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
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

CREATE TRIGGER checkup_item_set_next_due_insert
  BEFORE INSERT ON public.checkup_items
  FOR EACH ROW EXECUTE FUNCTION public.checkup_item_set_next_due_on_insert();

-- ============================================================================
-- TRIGGER: On INSERT checkup_completions — update item (next_due or status)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.checkup_completion_after_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
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

CREATE TRIGGER checkup_completion_after_insert_trigger
  AFTER INSERT ON public.checkup_completions
  FOR EACH ROW EXECUTE FUNCTION public.checkup_completion_after_insert();

-- ============================================================================
-- HELPER: Get checkup items for a condition (why_links contains condition id)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_checkups_for_condition(p_condition_id uuid)
RETURNS SETOF public.checkup_items
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
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
