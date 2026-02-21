BEGIN;
SELECT plan(15);

SELECT has_function('public', 'convert_to_canonical_unit', ARRAY['text', 'numeric', 'text']);
SELECT has_function('public', 'find_observation_by_synonym', ARRAY['text', 'text']);
SELECT has_function('public', 'find_finding_type_by_text', ARRAY['text', 'text']);
SELECT has_function('public', 'find_body_site_by_text', ARRAY['text', 'text']);

INSERT INTO public.observation_catalog (
  id,
  obs_code,
  name_ru,
  name_en,
  canonical_unit,
  accepted_units,
  synonyms_ru,
  synonyms_en
)
VALUES (
  'a1010101-0000-0000-0000-000000000001',
  'OBS-GLU',
  'Glucose RU',
  'Glucose',
  'mmol/L',
  '{
    "mmol/L": {"factor_to_canonical": 1},
    "mg/dL": {"factor_to_canonical": 0.0555},
    "g/L": {"formula": "manual"}
  }'::jsonb,
  ARRAY['glucose-ru'],
  ARRAY['glucose', 'blood sugar']
);

INSERT INTO public.finding_type_catalog (
  id,
  finding_code,
  name_ru,
  name_en,
  synonyms_ru,
  synonyms_en
)
VALUES (
  'b2020202-0000-0000-0000-000000000002',
  'F-CATALOG-1',
  'Nodule RU',
  'Nodule',
  ARRAY['nodule-ru'],
  ARRAY['nodule-en']
);

INSERT INTO public.body_site_catalog (
  id,
  site_code,
  name_ru,
  name_en,
  synonyms_ru,
  synonyms_en
)
VALUES (
  'c3030303-0000-0000-0000-000000000003',
  'HEAD',
  'Head RU',
  'Head',
  ARRAY['head-ru'],
  ARRAY['cephalic']
);

SELECT is(
  round(public.convert_to_canonical_unit('OBS-GLU', 100, 'mg/dL'), 2),
  5.55::numeric,
  'convert_to_canonical_unit applies factor_to_canonical conversion'
);

SELECT ok(
  public.convert_to_canonical_unit('OBS-GLU', 1, 'g/L') IS NULL,
  'convert_to_canonical_unit returns null when conversion is formula-based'
);

SELECT throws_ok(
  $$SELECT public.convert_to_canonical_unit('UNKNOWN', 1, 'mmol/L')$$,
  'Unknown observation code: UNKNOWN',
  'convert_to_canonical_unit rejects unknown observation code'
);

SELECT is(
  public.find_observation_by_synonym('blood sugar', 'en'),
  'OBS-GLU',
  'find_observation_by_synonym resolves english synonym'
);

SELECT is(
  public.find_observation_by_synonym('glucose-ru', 'en'),
  'OBS-GLU',
  'find_observation_by_synonym falls back to alternate language synonym set'
);

SELECT is(
  public.find_observation_by_synonym('not-a-known-observation', 'en'),
  NULL::text,
  'find_observation_by_synonym returns null when no match exists'
);

SELECT is(
  (
    SELECT finding_code
    FROM public.find_finding_type_by_text('nodule-en', 'en')
    LIMIT 1
  ),
  'F-CATALOG-1',
  'find_finding_type_by_text resolves by english synonym'
);

SELECT is(
  (
    SELECT id::text
    FROM public.find_finding_type_by_text('nodule-ru', 'ru')
    LIMIT 1
  ),
  'b2020202-0000-0000-0000-000000000002',
  'find_finding_type_by_text resolves by synonym'
);

SELECT is(
  (
    SELECT site_code
    FROM public.find_body_site_by_text('HEAD', 'en')
    LIMIT 1
  ),
  'HEAD',
  'find_body_site_by_text resolves by code'
);

SELECT is(
  (
    SELECT id::text
    FROM public.find_body_site_by_text('cephalic', 'en')
    LIMIT 1
  ),
  'c3030303-0000-0000-0000-000000000003',
  'find_body_site_by_text resolves by synonym'
);

SELECT is(
  (
    SELECT site_code
    FROM public.find_body_site_by_text('unknown-site', 'en')
    LIMIT 1
  ),
  NULL::text,
  'find_body_site_by_text returns null when no match exists'
);

SELECT * FROM finish();
ROLLBACK;
