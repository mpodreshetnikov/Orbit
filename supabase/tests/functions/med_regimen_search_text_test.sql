BEGIN;
SELECT plan(8);

SELECT has_function('public', 'med_regimen_search_text', ARRAY['med_regimens']);

INSERT INTO auth.users (id, email, aud, role)
VALUES ('a1a1a1a1-0000-4000-8000-000000000001', 'search-owner@example.com', 'authenticated', 'authenticated');

INSERT INTO public.persons (id, name, kind, auth_user_id)
VALUES ('a1a1a1a1-0000-4000-8000-000000000002', 'Search Person', 'human', 'a1a1a1a1-0000-4000-8000-000000000001');

INSERT INTO public.med_regimens (id, person_id, custom_name, schedule, duration, dose_definition)
VALUES
  (
    'a1a1a1a1-0000-4000-8000-000000000010',
    'a1a1a1a1-0000-4000-8000-000000000002',
    'Золофт',
    '{"mode":"daily_times","times":["09:00"],"amounts":[1.5]}'::jsonb,
    '{"type":"endless","start_date":"2026-08-22"}'::jsonb,
    '{"intake":{"amount":1.5,"unit":"pill"},"unit_strength":[{"name":"Сертралин","amount":100,"unit":"milligram"}],"active":[{"name":"Сертралин","amount":150,"unit":"milligram"}]}'::jsonb
  ),
  (
    'a1a1a1a1-0000-4000-8000-000000000011',
    'a1a1a1a1-0000-4000-8000-000000000002',
    'Атаракс',
    '{"mode":"daily_times","times":["22:00"]}'::jsonb,
    '{"type":"for_days","days":30,"start_date":"2026-08-21"}'::jsonb,
    '{"intake":{"amount":0.5,"unit":"pill"},"active":[{"name":"Гидроксизин","amount":12.5,"unit":"milligram"}]}'::jsonb
  ),
  (
    'a1a1a1a1-0000-4000-8000-000000000012',
    'a1a1a1a1-0000-4000-8000-000000000002',
    'D3',
    '{"mode":"daily_times","times":["09:00"]}'::jsonb,
    '{"type":"endless"}'::jsonb,
    '{"intake":{"amount":1,"unit":"capsule"},"active":"not an array","unit_strength":[42,{"name":"  "},{"amount":5}]}'::jsonb
  );

SELECT is(
  (SELECT public.med_regimen_search_text(r) FROM public.med_regimens r WHERE r.id = 'a1a1a1a1-0000-4000-8000-000000000010'),
  E'Золофт\nСертралин',
  'names the course and its per-unit ingredients, ahead of the legacy total'
);

SELECT is(
  (SELECT public.med_regimen_search_text(r) FROM public.med_regimens r WHERE r.id = 'a1a1a1a1-0000-4000-8000-000000000011'),
  E'Атаракс\nГидроксизин',
  'reads a legacy-only strength'
);

SELECT is(
  (SELECT public.med_regimen_search_text(r) FROM public.med_regimens r WHERE r.id = 'a1a1a1a1-0000-4000-8000-000000000012'),
  'D3',
  'skips a strength that is not an array, elements that are not objects, and blank or missing names'
);

SELECT is(
  (
    SELECT array_agg(r.custom_name ORDER BY r.custom_name)
    FROM public.med_regimens r
    WHERE r.person_id = 'a1a1a1a1-0000-4000-8000-000000000002'
      AND public.med_regimen_search_text(r) ~* 'сертралин'
  ),
  ARRAY['Золофт']::text[],
  'an ingredient search finds a course named for its brand'
);

SELECT is(
  (
    SELECT count(*)::int
    FROM public.med_regimens r
    WHERE r.person_id = 'a1a1a1a1-0000-4000-8000-000000000002'
      AND public.med_regimen_search_text(r) ~* 'фтС'
  ),
  0,
  'a search cannot match across the end of one name and the start of the next'
);

SELECT is(
  public.med_regimen_search_text(ROW(
    gen_random_uuid(), gen_random_uuid(), 'Курс', 'active', 'pill',
    '{"intake":{"amount":1,"unit":"pill"},"unit_strength":[{"name":"Флуоксетин","amount":20,"unit":"milligram"}],"active":[{"name":"Сертралин","amount":50,"unit":"milligram"}]}'::jsonb,
    'none', NULL, '{}'::jsonb, '{}'::jsonb, NULL, NULL, NULL, now(), now(), NULL
  )::public.med_regimens),
  E'Курс\nФлуоксетин',
  'a legacy total left behind by a replaced strength is not searched'
);

SELECT ok(
  has_function_privilege('authenticated', 'public.med_regimen_search_text(public.med_regimens)', 'EXECUTE'),
  'authenticated, the role the MCP server queries as, can filter on it'
);

SELECT * FROM finish();
ROLLBACK;
