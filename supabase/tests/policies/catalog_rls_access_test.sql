BEGIN;
SELECT plan(11);

INSERT INTO auth.users (id, email, aud, role)
VALUES (
  'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  'catalog-pass@example.com',
  'authenticated',
  'authenticated'
);

INSERT INTO public.allowed_users (email)
VALUES ('catalog-pass@example.com');

INSERT INTO public.persons (id, name, kind, auth_user_id)
VALUES (
  'bbbbbbbb-cccc-dddd-eeee-ffffffffffff',
  'Catalog Person',
  'human',
  'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
);

INSERT INTO public.body_site_catalog (id, site_code, name_ru, name_en, synonyms_ru, synonyms_en)
VALUES (
  'cccccccc-dddd-eeee-ffff-000000000001',
  'CAT-SITE-1',
  'Catalog Site RU',
  'Catalog Site',
  ARRAY['catalog-site-ru'],
  ARRAY['catalog-site-en']
);

INSERT INTO public.finding_type_catalog (id, finding_code, name_ru, name_en, synonyms_ru, synonyms_en)
VALUES (
  'dddddddd-eeee-ffff-0000-000000000002',
  'CAT-FIND-1',
  'Catalog Finding RU',
  'Catalog Finding',
  ARRAY['catalog-finding-ru'],
  ARRAY['catalog-finding-en']
);

INSERT INTO public.measurement_catalog (id, code, name_ru, name_en, category, unit_ru, unit_en)
VALUES (
  'eeeeeeee-ffff-0000-1111-000000000003',
  'CAT-MEAS-1',
  'Catalog Measurement RU',
  'Catalog Measurement',
  'vital',
  'unit-ru',
  'unit-en'
);

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
  'ffffffff-0000-1111-2222-000000000004',
  'CAT-OBS-1',
  'Catalog Observation RU',
  'Catalog Observation',
  'unit-en',
  '{"unit-en":{"factor_to_canonical":1}}'::jsonb,
  ARRAY['catalog-observation-ru'],
  ARRAY['catalog-observation-en']
);

INSERT INTO public.measurements (
  id,
  person_id,
  catalog_id,
  created_by_user_id,
  value,
  measured_at
)
VALUES (
  '11111111-2222-3333-4444-000000000005',
  'bbbbbbbb-cccc-dddd-eeee-ffffffffffff',
  'eeeeeeee-ffff-0000-1111-000000000003',
  'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  120,
  '2026-02-01T09:00:00+00'::timestamptz
);

SET LOCAL ROLE authenticated;

SELECT set_config('request.jwt.claim.email', 'catalog-deny@example.com', true);

SELECT is(
  (SELECT count(*) FROM public.body_site_catalog WHERE site_code = 'CAT-SITE-1'),
  1::bigint,
  'body_site_catalog select is readable by authenticated users'
);

SELECT is(
  (SELECT count(*) FROM public.finding_type_catalog WHERE finding_code = 'CAT-FIND-1'),
  1::bigint,
  'finding_type_catalog select is readable by authenticated users'
);

SELECT is(
  (SELECT count(*) FROM public.measurement_catalog WHERE code = 'CAT-MEAS-1'),
  1::bigint,
  'measurement_catalog select is readable by authenticated users'
);

SELECT is(
  (SELECT count(*) FROM public.observation_catalog WHERE obs_code = 'CAT-OBS-1'),
  1::bigint,
  'observation_catalog select is readable by authenticated users'
);

SELECT is(
  (SELECT count(*) FROM public.measurements WHERE id = '11111111-2222-3333-4444-000000000005'),
  0::bigint,
  'measurements select is denied for non-allowlisted users'
);

SELECT throws_ok(
  $$
    INSERT INTO public.observation_catalog (
      obs_code,
      name_ru,
      name_en,
      canonical_unit,
      accepted_units
    )
    VALUES (
      'CAT-OBS-DENY',
      'Denied RU',
      'Denied EN',
      'unit',
      '{"unit":{"factor_to_canonical":1}}'::jsonb
    )
  $$,
  'new row violates row-level security policy for table "observation_catalog"',
  'non-allowlisted user cannot insert into observation_catalog'
);

SELECT set_config('request.jwt.claim.email', 'catalog-pass@example.com', true);

INSERT INTO public.body_site_catalog (site_code, name_ru, name_en)
VALUES ('CAT-SITE-2', 'Site Two RU', 'Site Two');
SELECT is(
  (SELECT count(*) FROM public.body_site_catalog WHERE site_code = 'CAT-SITE-2'),
  1::bigint,
  'allowlisted user can insert into body_site_catalog'
);

INSERT INTO public.finding_type_catalog (finding_code, name_ru, name_en)
VALUES ('CAT-FIND-2', 'Finding Two RU', 'Finding Two');
SELECT is(
  (SELECT count(*) FROM public.finding_type_catalog WHERE finding_code = 'CAT-FIND-2'),
  1::bigint,
  'allowlisted user can insert into finding_type_catalog'
);

INSERT INTO public.measurement_catalog (code, name_ru, name_en, category, unit_ru, unit_en)
VALUES ('CAT-MEAS-2', 'Measurement Two RU', 'Measurement Two', 'vital', 'u-ru', 'u-en');
SELECT is(
  (SELECT count(*) FROM public.measurement_catalog WHERE code = 'CAT-MEAS-2'),
  1::bigint,
  'allowlisted user can insert into measurement_catalog'
);

INSERT INTO public.observation_catalog (obs_code, name_ru, name_en, canonical_unit, accepted_units)
VALUES (
  'CAT-OBS-2',
  'Observation Two RU',
  'Observation Two',
  'unit',
  '{"unit":{"factor_to_canonical":1}}'::jsonb
);
SELECT is(
  (SELECT count(*) FROM public.observation_catalog WHERE obs_code = 'CAT-OBS-2'),
  1::bigint,
  'allowlisted user can insert into observation_catalog'
);

SELECT is(
  (SELECT count(*) FROM public.measurements WHERE id = '11111111-2222-3333-4444-000000000005'),
  1::bigint,
  'allowlisted user can read measurements row'
);

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
