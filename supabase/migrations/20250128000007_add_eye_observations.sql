-- ============================================================================
-- EYE OBSERVATION CATALOG
-- Basic eye/vision-related observations
-- ============================================================================

INSERT INTO public.observation_catalog (obs_code, name_ru, name_en, canonical_unit, synonyms_ru, synonyms_en, accepted_units, notes)
VALUES
  -- Visual Acuity (decimal notation)
  (
    'visual_acuity_od',
    'Острота зрения OD (правый глаз)',
    'Visual acuity OD (right eye)',
    'decimal',
    ARRAY['острота зрения od', 'vis od', 'зрение правый глаз'],
    ARRAY['visual acuity od', 'va od', 'vision od', 'right eye acuity'],
    '{"decimal": {"factor_to_canonical": 1}}'::jsonb,
    'Decimal notation (e.g., 1.0 = 20/20)'
  ),
  
  (
    'visual_acuity_os',
    'Острота зрения OS (левый глаз)',
    'Visual acuity OS (left eye)',
    'decimal',
    ARRAY['острота зрения os', 'vis os', 'зрение левый глаз'],
    ARRAY['visual acuity os', 'va os', 'vision os', 'left eye acuity'],
    '{"decimal": {"factor_to_canonical": 1}}'::jsonb,
    'Decimal notation (e.g., 1.0 = 20/20)'
  ),
  
  -- Intraocular Pressure
  (
    'iop_od',
    'Внутриглазное давление OD',
    'Intraocular pressure OD (right eye)',
    'mmHg',
    ARRAY['вгд od', 'вгд правый', 'глазное давление od'],
    ARRAY['iop od', 'eye pressure od', 'intraocular pressure right'],
    '{"mmHg": {"factor_to_canonical": 1}}'::jsonb,
    'Normal range: 10-21 mmHg'
  ),
  
  (
    'iop_os',
    'Внутриглазное давление OS',
    'Intraocular pressure OS (left eye)',
    'mmHg',
    ARRAY['вгд os', 'вгд левый', 'глазное давление os'],
    ARRAY['iop os', 'eye pressure os', 'intraocular pressure left'],
    '{"mmHg": {"factor_to_canonical": 1}}'::jsonb,
    'Normal range: 10-21 mmHg'
  ),
  
  -- Refraction (Spherical equivalent)
  (
    'refraction_sph_od',
    'Рефракция сфера OD',
    'Refraction sphere OD (right eye)',
    'D',
    ARRAY['сфера od', 'sph od', 'рефракция od'],
    ARRAY['sphere od', 'sph od', 'refraction od'],
    '{"D": {"factor_to_canonical": 1}}'::jsonb,
    'Diopters. Negative = myopia, Positive = hyperopia'
  ),
  
  (
    'refraction_sph_os',
    'Рефракция сфера OS',
    'Refraction sphere OS (left eye)',
    'D',
    ARRAY['сфера os', 'sph os', 'рефракция os'],
    ARRAY['sphere os', 'sph os', 'refraction os'],
    '{"D": {"factor_to_canonical": 1}}'::jsonb,
    'Diopters. Negative = myopia, Positive = hyperopia'
  )
ON CONFLICT (obs_code) DO UPDATE SET
  name_ru = EXCLUDED.name_ru,
  name_en = EXCLUDED.name_en,
  canonical_unit = EXCLUDED.canonical_unit,
  synonyms_ru = EXCLUDED.synonyms_ru,
  synonyms_en = EXCLUDED.synonyms_en,
  accepted_units = EXCLUDED.accepted_units,
  notes = EXCLUDED.notes,
  updated_at = now();
