-- Function: checkup_compute_next_due()
-- Compute next_due_at from schedule + base date

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

COMMENT ON FUNCTION public.checkup_compute_next_due(jsonb, date) IS
  'Compute next due date for a checkup item based on schedule and base date.';
