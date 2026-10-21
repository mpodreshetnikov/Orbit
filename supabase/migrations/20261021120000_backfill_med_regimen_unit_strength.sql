-- Backfill a per-unit strength onto courses that only record a per-intake total (ADR-260907-cvj).
--
-- `dose_definition.active` is what the whole intake delivers; `unit_strength` is what one unit of
-- the dosage form contains, and is what every reader prefers. A course written before
-- `unit_strength` existed has only the former, so an edit of its amount leaves a total recorded for
-- a number of units the row no longer holds. Dividing the total by the course's own amount gives
-- the per-unit figure exactly: the two were written together, by the same call, for the same
-- course. «2 таблетки по 50 мг» stored as {2 pill, Сертралин 100 mg} becomes Сертралин 50 mg per
-- pill.
--
-- Only courses, never dose events. An event's amount is overridden per slot by the generator and
-- per intake by a `log_dose` correction, while its `active` was copied from the definition, so the
-- two need not belong together and dividing them would invent a strength. Events keep their legacy
-- total and the renderer's withholding rule for it; an event regenerated from a migrated course
-- carries the course's `unit_strength`.
--
-- A course is left as it is when:
--   * it already has a `unit_strength` key, empty included -- an explicit `[]` is a cleared strength;
--   * its `active` is not a non-empty array of {name, amount, unit} with a positive numeric amount;
--   * its intake amount is not a positive number;
--   * every ingredient would come out as 1 of the intake's own unit -- the dosage form is the
--     ingredient itself, a powder dosed in milligrams, where `unit_strength` is omitted by design.
--
-- `active` stays: it is read for history and removed separately. Idempotent: a second run finds
-- every migrated row already carrying `unit_strength`.

WITH candidates AS (
  SELECT
    r.id,
    (r.dose_definition->'intake'->>'amount')::numeric AS intake_amount,
    r.dose_definition->'intake'->>'unit' AS intake_unit,
    r.dose_definition->'active' AS active
  FROM public.med_regimens r
  WHERE NOT (r.dose_definition ? 'unit_strength')
    AND jsonb_typeof(r.dose_definition->'active') = 'array'
    AND jsonb_array_length(r.dose_definition->'active') > 0
    AND jsonb_typeof(r.dose_definition->'intake'->'amount') = 'number'
    AND (r.dose_definition->'intake'->>'amount')::numeric > 0
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(r.dose_definition->'active') AS ingredient
      WHERE jsonb_typeof(ingredient) <> 'object'
        OR jsonb_typeof(ingredient->'name') <> 'string'
        OR nullif(btrim(ingredient->>'name'), '') IS NULL
        OR jsonb_typeof(ingredient->'unit') <> 'string'
        OR jsonb_typeof(ingredient->'amount') <> 'number'
        OR (ingredient->>'amount')::numeric <= 0
    )
),
derived AS (
  SELECT
    c.id,
    jsonb_agg(
      jsonb_build_object(
        'name', ingredient->>'name',
        'amount', trim_scale(round((ingredient->>'amount')::numeric / c.intake_amount, 6)),
        'unit', ingredient->>'unit'
      )
      ORDER BY ordinality
    ) AS unit_strength,
    bool_and(
      (ingredient->>'amount')::numeric = c.intake_amount
      AND ingredient->>'unit' = c.intake_unit
    ) AS form_is_ingredient
  FROM candidates c
  CROSS JOIN LATERAL jsonb_array_elements(c.active) WITH ORDINALITY AS a(ingredient, ordinality)
  GROUP BY c.id
)
UPDATE public.med_regimens r
SET dose_definition = r.dose_definition || jsonb_build_object('unit_strength', d.unit_strength)
FROM derived d
WHERE r.id = d.id
  AND NOT d.form_is_ingredient;
