-- Seed data for Orbit
-- This file runs automatically after migrations during `supabase db reset`

-- ============================================================================
-- AUTH USERS
-- ============================================================================
-- Create the auth user first so we can reference their ID in other tables

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, 
  email_confirmed_at, last_sign_in_at, 
  raw_app_meta_data, raw_user_meta_data, 
  created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, email_change_confirm_status,
  phone, phone_change, phone_change_token, reauthentication_token,
  is_sso_user, deleted_at, is_anonymous
) VALUES (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'dev@example.com',
  '', -- No password for Google OAuth
  '2026-01-26 09:29:01.650419+00',
  '2026-01-26 09:29:03.109062+00',
  '{"provider": "google", "providers": ["google"]}'::jsonb,
  '{"iss": "https://accounts.google.com", "sub": "100000000000000000001", "name": "Dev User", "email": "dev@example.com", "picture": "https://example.com/avatar.png", "full_name": "Dev User", "avatar_url": "https://example.com/avatar.png", "provider_id": "100000000000000000001", "email_verified": true, "phone_verified": false}'::jsonb,
  '2026-01-26 09:29:01.638543+00',
  '2026-01-26 09:29:09.628281+00',
  '', '', '', '',  -- confirmation_token, recovery_token, email_change_token_new, email_change
  '', 0,           -- email_change_token_current, email_change_confirm_status
  '', '', '', '',  -- phone, phone_change, phone_change_token, reauthentication_token
  false,
  NULL,
  false
)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- ALLOWED USERS
-- ============================================================================
-- Link the allowed user to the auth user we just created

INSERT INTO public.allowed_users (auth_user_id, email, added_at) VALUES
  ('00000000-0000-4000-8000-000000000001', 'dev@example.com', now())
ON CONFLICT (email) DO UPDATE SET auth_user_id = EXCLUDED.auth_user_id;

-- ============================================================================
-- PERSONS (Humans and Pets)
-- ============================================================================
-- Sample family members and pets
-- Note: auth_user_id can be linked later via Supabase console after users sign in

-- Human family members
INSERT INTO public.persons (name, kind, birthday, sex, auth_user_id) VALUES
  ('Max', 'human', '2001-01-24', 'male', '00000000-0000-4000-8000-000000000001'),
  ('Kate', 'human', '1998-08-14', 'female', NULL)
ON CONFLICT DO NOTHING;

-- Pet family members
INSERT INTO public.persons (name, kind, species, sex, birthday, breed) VALUES
  ('Demi', 'pet', 'dog', 'female', NULL, 'Labrador')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- MEDICAL RECORDS (Sample data)
-- ============================================================================
-- Get person IDs for sample records
DO $$
DECLARE
  v_max_person_id uuid;
  v_kate_person_id uuid;
  v_demi_person_id uuid;
  v_user_id uuid := '00000000-0000-4000-8000-000000000001';
  v_record_id uuid;
BEGIN
  -- Get person IDs
  SELECT id INTO v_max_person_id FROM public.persons WHERE name = 'Max' LIMIT 1;
  SELECT id INTO v_kate_person_id FROM public.persons WHERE name = 'Kate' LIMIT 1;
  SELECT id INTO v_demi_person_id FROM public.persons WHERE name = 'Demi' LIMIT 1;

  -- Sample records for Max
  IF v_max_person_id IS NOT NULL THEN
    -- Blood test record
    INSERT INTO public.medical_records (
      id, person_id, created_by_user_id, record_type, record_date, title, notes, status
    ) VALUES (
      'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      v_max_person_id,
      v_user_id,
      'lab',
      '2025-12-15',
      'Annual Blood Test Results',
      'Complete blood count, metabolic panel, and lipid profile. All values within normal range.',
      'active'
    ) ON CONFLICT (id) DO NOTHING;

    -- Doctor visit record
    INSERT INTO public.medical_records (
      id, person_id, created_by_user_id, record_type, record_date, title, notes, status
    ) VALUES (
      'b2c3d4e5-f6a7-8901-bcde-f12345678901',
      v_max_person_id,
      v_user_id,
      'visit',
      '2025-11-20',
      'General Checkup',
      'Annual physical examination. Blood pressure 120/80, weight stable. Recommended to continue current lifestyle.',
      'active'
    ) ON CONFLICT (id) DO NOTHING;

    -- Vaccination record
    INSERT INTO public.medical_records (
      id, person_id, created_by_user_id, record_type, record_date, title, notes, status
    ) VALUES (
      'c3d4e5f6-a7b8-9012-cdef-123456789012',
      v_max_person_id,
      v_user_id,
      'vaccination',
      '2025-10-01',
      'Flu Vaccination 2025',
      'Seasonal influenza vaccine administered. No adverse reactions.',
      'active'
    ) ON CONFLICT (id) DO NOTHING;
  END IF;

  -- Sample record for Kate
  IF v_kate_person_id IS NOT NULL THEN
    INSERT INTO public.medical_records (
      id, person_id, created_by_user_id, record_type, record_date, title, notes, status
    ) VALUES (
      'd4e5f6a7-b8c9-0123-defa-234567890123',
      v_kate_person_id,
      v_user_id,
      'imaging',
      '2025-09-15',
      'Dental X-Ray',
      'Routine dental checkup x-rays. No cavities detected.',
      'active'
    ) ON CONFLICT (id) DO NOTHING;
  END IF;

  -- Sample records for Demi (pet)
  IF v_demi_person_id IS NOT NULL THEN
    -- Vet visit
    INSERT INTO public.medical_records (
      id, person_id, created_by_user_id, record_type, record_date, title, notes, status
    ) VALUES (
      'e5f6a7b8-c9d0-1234-efab-345678901234',
      v_demi_person_id,
      v_user_id,
      'vet',
      '2025-08-10',
      'Annual Vet Checkup',
      'Weight: 25kg. Healthy coat and teeth. Heart and lungs sound good. Recommended dental cleaning.',
      'active'
    ) ON CONFLICT (id) DO NOTHING;

    -- Pet vaccination
    INSERT INTO public.medical_records (
      id, person_id, created_by_user_id, record_type, record_date, title, notes, status
    ) VALUES (
      'f6a7b8c9-d0e1-2345-fabc-456789012345',
      v_demi_person_id,
      v_user_id,
      'vaccination',
      '2025-08-10',
      'Rabies & DHPP Vaccines',
      'Annual rabies and DHPP (Distemper, Hepatitis, Parvovirus, Parainfluenza) vaccinations. Next due: August 2026.',
      'active'
    ) ON CONFLICT (id) DO NOTHING;

    -- Draft record example
    INSERT INTO public.medical_records (
      id, person_id, created_by_user_id, record_type, record_date, title, notes, status
    ) VALUES (
      'a7b8c9d0-e1f2-3456-abcd-567890123456',
      v_demi_person_id,
      v_user_id,
      'other',
      NULL,
      'Grooming Visit',
      NULL,
      'draft'
    ) ON CONFLICT (id) DO NOTHING;
  END IF;
END $$;

-- ============================================================================
-- MEASUREMENTS (Sample data for body tracking)
-- ============================================================================
-- Add sample measurements for Max to demonstrate the measurements feature
DO $$
DECLARE
  v_max_person_id uuid;
  v_user_id uuid := '00000000-0000-4000-8000-000000000001';
  v_height_catalog_id uuid;
  v_weight_catalog_id uuid;
  v_chest_catalog_id uuid;
  v_waist_catalog_id uuid;
  v_bicep_left_catalog_id uuid;
  v_bicep_right_catalog_id uuid;
BEGIN
  -- Get person ID for Max
  SELECT id INTO v_max_person_id FROM public.persons WHERE name = 'Max' LIMIT 1;
  
  -- Get catalog IDs
  SELECT id INTO v_height_catalog_id FROM public.measurement_catalog WHERE code = 'height';
  SELECT id INTO v_weight_catalog_id FROM public.measurement_catalog WHERE code = 'weight';
  SELECT id INTO v_chest_catalog_id FROM public.measurement_catalog WHERE code = 'chest';
  SELECT id INTO v_waist_catalog_id FROM public.measurement_catalog WHERE code = 'waist';
  SELECT id INTO v_bicep_left_catalog_id FROM public.measurement_catalog WHERE code = 'bicep_left';
  SELECT id INTO v_bicep_right_catalog_id FROM public.measurement_catalog WHERE code = 'bicep_right';

  IF v_max_person_id IS NOT NULL AND v_height_catalog_id IS NOT NULL THEN
    -- Height measurements (one value, as height doesn't change much)
    INSERT INTO public.measurements (person_id, catalog_id, value, measured_at, notes, created_by_user_id) VALUES
      (v_max_person_id, v_height_catalog_id, 180, '2025-01-15 10:00:00+00', 'Annual checkup measurement', v_user_id)
    ON CONFLICT DO NOTHING;

    -- Weight measurements over time (showing progress)
    INSERT INTO public.measurements (person_id, catalog_id, value, measured_at, notes, created_by_user_id) VALUES
      (v_max_person_id, v_weight_catalog_id, 82.5, '2025-07-01 08:30:00+00', 'Starting point', v_user_id),
      (v_max_person_id, v_weight_catalog_id, 81.2, '2025-08-01 08:15:00+00', 'Down 1.3kg', v_user_id),
      (v_max_person_id, v_weight_catalog_id, 80.8, '2025-09-01 08:00:00+00', NULL, v_user_id),
      (v_max_person_id, v_weight_catalog_id, 79.5, '2025-10-01 08:30:00+00', 'Good progress!', v_user_id),
      (v_max_person_id, v_weight_catalog_id, 79.8, '2025-11-01 08:00:00+00', 'Slight increase after holiday', v_user_id),
      (v_max_person_id, v_weight_catalog_id, 78.2, '2025-12-01 08:15:00+00', NULL, v_user_id),
      (v_max_person_id, v_weight_catalog_id, 77.5, '2026-01-15 08:00:00+00', 'Target reached!', v_user_id)
    ON CONFLICT DO NOTHING;

    -- Chest measurements
    INSERT INTO public.measurements (person_id, catalog_id, value, measured_at, notes, created_by_user_id) VALUES
      (v_max_person_id, v_chest_catalog_id, 98, '2025-07-01 08:35:00+00', NULL, v_user_id),
      (v_max_person_id, v_chest_catalog_id, 99, '2025-10-01 08:35:00+00', NULL, v_user_id),
      (v_max_person_id, v_chest_catalog_id, 100, '2026-01-15 08:05:00+00', 'Muscle gain', v_user_id)
    ON CONFLICT DO NOTHING;

    -- Waist measurements
    INSERT INTO public.measurements (person_id, catalog_id, value, measured_at, notes, created_by_user_id) VALUES
      (v_max_person_id, v_waist_catalog_id, 88, '2025-07-01 08:36:00+00', NULL, v_user_id),
      (v_max_person_id, v_waist_catalog_id, 86, '2025-10-01 08:36:00+00', NULL, v_user_id),
      (v_max_person_id, v_waist_catalog_id, 84, '2026-01-15 08:06:00+00', 'Good progress on waist', v_user_id)
    ON CONFLICT DO NOTHING;

    -- Bicep measurements
    INSERT INTO public.measurements (person_id, catalog_id, value, measured_at, notes, created_by_user_id) VALUES
      (v_max_person_id, v_bicep_left_catalog_id, 34, '2025-07-01 08:40:00+00', NULL, v_user_id),
      (v_max_person_id, v_bicep_left_catalog_id, 35, '2025-10-01 08:40:00+00', NULL, v_user_id),
      (v_max_person_id, v_bicep_left_catalog_id, 36, '2026-01-15 08:10:00+00', NULL, v_user_id),
      (v_max_person_id, v_bicep_right_catalog_id, 34.5, '2025-07-01 08:41:00+00', NULL, v_user_id),
      (v_max_person_id, v_bicep_right_catalog_id, 35.5, '2025-10-01 08:41:00+00', NULL, v_user_id),
      (v_max_person_id, v_bicep_right_catalog_id, 36.5, '2026-01-15 08:11:00+00', NULL, v_user_id)
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

-- ============================================================================
-- RECORD OBSERVATIONS (lab values on medical records)
-- ============================================================================
-- Add observations to Max's blood test record for debugging observations UI
DO $$
DECLARE
  v_record_id uuid := 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
  v_cat_hemoglobin uuid;
  v_cat_glucose uuid;
  v_cat_vitamin_b12 uuid;
  v_cat_ferritin uuid;
  v_cat_creatinine uuid;
  v_cat_tsh uuid;
  v_cat_vitamin_d uuid;
BEGIN
  SELECT id INTO v_cat_hemoglobin FROM public.observation_catalog WHERE obs_code = 'hemoglobin' LIMIT 1;
  SELECT id INTO v_cat_glucose FROM public.observation_catalog WHERE obs_code = 'glucose' LIMIT 1;
  SELECT id INTO v_cat_vitamin_b12 FROM public.observation_catalog WHERE obs_code = 'vitamin_b12' LIMIT 1;
  SELECT id INTO v_cat_ferritin FROM public.observation_catalog WHERE obs_code = 'ferritin' LIMIT 1;
  SELECT id INTO v_cat_creatinine FROM public.observation_catalog WHERE obs_code = 'creatinine' LIMIT 1;
  SELECT id INTO v_cat_tsh FROM public.observation_catalog WHERE obs_code = 'tsh' LIMIT 1;
  SELECT id INTO v_cat_vitamin_d FROM public.observation_catalog WHERE obs_code = 'vitamin_d_25oh' LIMIT 1;

  IF v_cat_hemoglobin IS NOT NULL THEN
    DELETE FROM public.record_observations WHERE record_id = v_record_id;
    INSERT INTO public.record_observations (
      record_id, catalog_id, obs_code, obs_name, value_numeric, value_text, unit,
      value_canonical, unit_canonical, ref_range_text, ref_range_low, ref_range_high, status,
      is_llm_extracted, is_user_verified, confidence
    ) VALUES
      (v_record_id, v_cat_hemoglobin, 'hemoglobin', 'Hemoglobin', 142, '142', 'g/L', 142, 'g/L', '130-170', 130, 170, 'normal', true, false, 0.95),
      (v_record_id, v_cat_glucose, 'glucose', 'Glucose', 5.2, '5.2', 'mmol/L', 5.2, 'mmol/L', '3.9-6.1', 3.9, 6.1, 'normal', true, false, 0.98),
      (v_record_id, v_cat_vitamin_b12, 'vitamin_b12', 'Vitamin B12', 280, '280', 'pmol/L', 280, 'pmol/L', '133-675', 133, 675, 'normal', true, false, 0.92),
      (v_record_id, v_cat_ferritin, 'ferritin', 'Ferritin', 85, '85', 'ug/L', 85, 'ug/L', '30-400', 30, 400, 'normal', true, false, 0.94),
      (v_record_id, v_cat_creatinine, 'creatinine', 'Creatinine', 88, '88', 'umol/L', 88, 'umol/L', '62-106', 62, 106, 'normal', true, false, 0.96),
      (v_record_id, v_cat_tsh, 'tsh', 'TSH', 2.1, '2.1', 'mIU/L', 2.1, 'mIU/L', '0.27-4.2', 0.27, 4.2, 'normal', true, false, 0.97),
      (v_record_id, v_cat_vitamin_d, 'vitamin_d_25oh', '25(OH) Vitamin D', 52, '52', 'nmol/L', 52, 'nmol/L', '50-125', 50, 125, 'normal', true, false, 0.93);
  END IF;
END $$;

-- ============================================================================
-- RECORD FINDINGS (imaging/endoscopy findings on medical records)
-- ============================================================================
-- Add findings to Kate's imaging record for debugging findings UI
DO $$
DECLARE
  v_kate_person_id uuid;
  v_record_id uuid := 'd4e5f6a7-b8c9-0123-defa-234567890123';
  v_finding_polyp uuid;
  v_finding_cyst uuid;
  v_site_colon_sigmoid uuid;
  v_site_kidney_left uuid;
BEGIN
  SELECT id INTO v_kate_person_id FROM public.persons WHERE name = 'Kate' LIMIT 1;
  SELECT id INTO v_finding_polyp FROM public.finding_type_catalog WHERE finding_code = 'polyp' LIMIT 1;
  SELECT id INTO v_finding_cyst FROM public.finding_type_catalog WHERE finding_code = 'cyst' LIMIT 1;
  SELECT id INTO v_site_colon_sigmoid FROM public.body_site_catalog WHERE site_code = 'colon_sigmoid' LIMIT 1;
  SELECT id INTO v_site_kidney_left FROM public.body_site_catalog WHERE site_code = 'kidney_left' LIMIT 1;

  IF v_kate_person_id IS NOT NULL AND v_finding_polyp IS NOT NULL THEN
    DELETE FROM public.record_findings WHERE record_id = v_record_id;
    INSERT INTO public.record_findings (
      person_id, record_id, finding_type_id, finding_code, finding_type_text,
      body_site_id, site_code, body_site_text, size_mm, count, severity, laterality,
      description, finding_date, source_anchor, is_llm_extracted, is_user_verified, confidence
    ) VALUES
      (v_kate_person_id, v_record_id, v_finding_polyp, 'polyp', 'Polyp',
       v_site_colon_sigmoid, 'colon_sigmoid', 'Sigmoid colon', 5, 1, 'mild', 'none',
       'Small hyperplastic polyp. Recommended follow-up in 5 years.',
       '2025-09-15', '«Полип сигмовидной кишки до 5 мм, гиперпластический»', true, false, 0.9),
      (v_kate_person_id, v_record_id, v_finding_cyst, 'cyst', 'Simple cyst',
       v_site_kidney_left, 'kidney_left', 'Left kidney', 12, 1, 'mild', 'left',
       'Simple cortical cyst, no septations. Incidental finding.',
       '2025-09-15', '«Простая киста левой почки 12 мм»', true, false, 0.88);
  END IF;
END $$;

-- ============================================================================
-- CONDITIONS & CONDITION_RECORDS (diagnoses linked to records)
-- ============================================================================
-- Add conditions for Max and link them to medical records
DO $$
DECLARE
  v_max_person_id uuid;
  v_cond_b12_id uuid;
  v_cond_hypertension_id uuid;
  v_cond_rhinitis_id uuid;
  v_blood_record_id uuid := 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
  v_visit_record_id uuid := 'b2c3d4e5-f6a7-8901-bcde-f12345678901';
BEGIN
  SELECT id INTO v_max_person_id FROM public.persons WHERE name = 'Max' LIMIT 1;

  IF v_max_person_id IS NOT NULL THEN
    -- Get or create condition: Vitamin B12 deficiency (resolved)
    SELECT id INTO v_cond_b12_id FROM public.conditions WHERE person_id = v_max_person_id AND code = 'E53.8' AND deleted_at IS NULL LIMIT 1;
    IF v_cond_b12_id IS NULL THEN
      INSERT INTO public.conditions (person_id, name, icd_name_en, code, current_status, onset_date, resolved_date, notes)
      VALUES (
        v_max_person_id,
        'Vitamin B12 deficiency',
        'Dietary vitamin B12 deficiency',
        'E53.8',
        'resolved',
        '2024-06-01',
        '2024-12-01',
        'Treated with oral B12. Levels normalized on repeat labs.'
      )
      RETURNING id INTO v_cond_b12_id;
    END IF;

    -- Get or create condition: Essential hypertension (active)
    SELECT id INTO v_cond_hypertension_id FROM public.conditions WHERE person_id = v_max_person_id AND code = 'I10' AND deleted_at IS NULL LIMIT 1;
    IF v_cond_hypertension_id IS NULL THEN
      INSERT INTO public.conditions (person_id, name, icd_name_en, code, current_status, onset_date, notes)
      VALUES (
        v_max_person_id,
        'Essential hypertension',
        'Essential (primary) hypertension',
        'I10',
        'active',
        '2023-01-01',
        'Controlled with lifestyle. BP 120/80 at last checkup.'
      )
      RETURNING id INTO v_cond_hypertension_id;
    END IF;

    -- Get or create condition: Allergic rhinitis (active)
    SELECT id INTO v_cond_rhinitis_id FROM public.conditions WHERE person_id = v_max_person_id AND code = 'J30.4' AND deleted_at IS NULL LIMIT 1;
    IF v_cond_rhinitis_id IS NULL THEN
      INSERT INTO public.conditions (person_id, name, icd_name_en, code, current_status, onset_date, notes)
      VALUES (
        v_max_person_id,
        'Allergic rhinitis',
        'Allergic rhinitis, unspecified',
        'J30.4',
        'active',
        '2020-05-01',
        NULL
      )
      RETURNING id INTO v_cond_rhinitis_id;
    END IF;

    -- Link conditions to records via condition_records
    IF v_cond_b12_id IS NOT NULL THEN
      INSERT INTO public.condition_records (condition_id, record_id, status_in_record, source_anchor, confidence, is_llm_extracted, is_user_verified)
      VALUES (v_cond_b12_id, v_blood_record_id, 'resolved', 'B12 within normal range on current labs', 0.9, true, false)
      ON CONFLICT (condition_id, record_id) DO NOTHING;
    END IF;

    IF v_cond_hypertension_id IS NOT NULL THEN
      INSERT INTO public.condition_records (condition_id, record_id, status_in_record, source_anchor, confidence, is_llm_extracted, is_user_verified)
      VALUES
        (v_cond_hypertension_id, v_blood_record_id, 'active', 'Hypertension; BP well controlled', 0.92, true, false),
        (v_cond_hypertension_id, v_visit_record_id, 'active', 'Blood pressure 120/80', 0.95, true, false)
      ON CONFLICT (condition_id, record_id) DO NOTHING;
    END IF;

    IF v_cond_rhinitis_id IS NOT NULL THEN
      INSERT INTO public.condition_records (condition_id, record_id, status_in_record, source_anchor, confidence, is_llm_extracted, is_user_verified)
      VALUES (v_cond_rhinitis_id, v_visit_record_id, 'active', 'Allergic rhinitis, seasonal', 0.88, true, false)
      ON CONFLICT (condition_id, record_id) DO NOTHING;
    END IF;
  END IF;
END $$;

-- ============================================================================
-- CHECKUPS (checkup_items + checkup_completions for dev testing)
-- ============================================================================
DO $$
DECLARE
  v_max_person_id uuid;
  v_kate_person_id uuid;
  v_demi_person_id uuid;
  v_cond_hypertension_id uuid;
  v_blood_record_id uuid := 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
  v_visit_record_id uuid := 'b2c3d4e5-f6a7-8901-bcde-f12345678901';
  v_item_blood_id uuid := '10000001-0000-4000-8000-000000000001';
  v_item_visit_id uuid := '10000001-0000-4000-8000-000000000002';
  v_item_flu_id uuid := '10000001-0000-4000-8000-000000000003';
  v_item_dental_id uuid := '10000001-0000-4000-8000-000000000004';
  v_item_demi_vet_id uuid := '10000001-0000-4000-8000-000000000005';
  v_item_demi_rabies_id uuid := '10000001-0000-4000-8000-000000000006';
  v_item_oneoff_id uuid := '10000001-0000-4000-8000-000000000007';
BEGIN
  SELECT id INTO v_max_person_id FROM public.persons WHERE name = 'Max' LIMIT 1;
  SELECT id INTO v_kate_person_id FROM public.persons WHERE name = 'Kate' LIMIT 1;
  SELECT id INTO v_demi_person_id FROM public.persons WHERE name = 'Demi' LIMIT 1;
  SELECT c.id INTO v_cond_hypertension_id FROM public.conditions c
    JOIN public.persons p ON p.id = c.person_id
    WHERE p.name = 'Max' AND c.code = 'I10' AND c.deleted_at IS NULL LIMIT 1;

  -- Max: annual blood work (interval, every 12 months)
  IF v_max_person_id IS NOT NULL THEN
    INSERT INTO public.checkup_items (
      id, person_id, title, category, schedule, status, why_text, why_links, notes
    ) VALUES (
      v_item_blood_id,
      v_max_person_id,
      'Annual blood work',
      'lab',
      '{"type": "interval", "every": 12, "unit": "month", "anchor_date": "2025-12-15"}'::jsonb,
      'active',
      'Monitor hypertension and general health',
      CASE WHEN v_cond_hypertension_id IS NOT NULL
        THEN jsonb_build_array(jsonb_build_object('type', 'condition', 'id', v_cond_hypertension_id::text, 'label', 'Essential hypertension'))
        ELSE '[]'::jsonb
      END,
      'CBC, metabolic panel, lipids.'
    ) ON CONFLICT (id) DO NOTHING;

    -- Max: annual physical (interval, every 12 months)
    INSERT INTO public.checkup_items (
      id, person_id, title, category, schedule, status, notes
    ) VALUES (
      v_item_visit_id,
      v_max_person_id,
      'Annual physical',
      'visit',
      '{"type": "interval", "every": 12, "unit": "month", "anchor_date": "2025-11-20"}'::jsonb,
      'active',
      'BP check, weight, general exam.'
    ) ON CONFLICT (id) DO NOTHING;

    -- Max: flu shot (interval, every 12 months)
    INSERT INTO public.checkup_items (
      id, person_id, title, category, schedule, status
    ) VALUES (
      v_item_flu_id,
      v_max_person_id,
      'Flu vaccination',
      'vaccination',
      '{"type": "interval", "every": 12, "unit": "year", "anchor_date": "2025-10-01"}'::jsonb,
      'active'
    ) ON CONFLICT (id) DO NOTHING;

    -- One-off checkup (e.g. follow-up)
    INSERT INTO public.checkup_items (
      id, person_id, title, category, schedule, status, notes
    ) VALUES (
      v_item_oneoff_id,
      v_max_person_id,
      'Follow-up thyroid check',
      'lab',
      '{"type": "one_off", "due_at": "2026-03-15"}'::jsonb,
      'active',
      'TSH recheck after adjustment.'
    ) ON CONFLICT (id) DO NOTHING;
  END IF;

  -- Kate: dental cleaning (interval, every 6 months)
  IF v_kate_person_id IS NOT NULL THEN
    INSERT INTO public.checkup_items (
      id, person_id, title, category, schedule, status, notes
    ) VALUES (
      v_item_dental_id,
      v_kate_person_id,
      'Dental cleaning',
      'dental',
      '{"type": "interval", "every": 6, "unit": "month", "anchor_date": "2025-09-15"}'::jsonb,
      'active',
      'Routine cleaning and x-rays.'
    ) ON CONFLICT (id) DO NOTHING;
  END IF;

  -- Demi: vet checkup + rabies (intervals)
  IF v_demi_person_id IS NOT NULL THEN
    INSERT INTO public.checkup_items (
      id, person_id, title, category, schedule, status, notes
    ) VALUES (
      v_item_demi_vet_id,
      v_demi_person_id,
      'Annual vet checkup',
      'visit',
      '{"type": "interval", "every": 12, "unit": "year", "anchor_date": "2025-08-10"}'::jsonb,
      'active',
      'Weight, teeth, heart, lungs.'
    ) ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.checkup_items (
      id, person_id, title, category, schedule, status, notes
    ) VALUES (
      v_item_demi_rabies_id,
      v_demi_person_id,
      'Rabies vaccination',
      'vaccination',
      '{"type": "interval", "every": 12, "unit": "year", "anchor_date": "2025-08-10"}'::jsonb,
      'active',
      'Next due August 2026.'
    ) ON CONFLICT (id) DO NOTHING;
  END IF;

  -- Completions: mark some as done so next_due_at advances (triggers run on insert)
  -- Use fixed IDs so re-run is idempotent (ON CONFLICT (id) DO NOTHING).
  -- Blood work done 2025-12-15 -> next_due 2026-12-15
  INSERT INTO public.checkup_completions (id, checkup_item_id, done_at, note, evidence_record_id)
  VALUES ('20000001-0000-4000-8000-000000000001', v_item_blood_id, '2025-12-15', 'All within range.', v_blood_record_id)
  ON CONFLICT (id) DO NOTHING;

  -- Annual physical done 2025-11-20 -> next_due 2026-11-20
  INSERT INTO public.checkup_completions (id, checkup_item_id, done_at, note, evidence_record_id)
  VALUES ('20000001-0000-4000-8000-000000000002', v_item_visit_id, '2025-11-20', 'BP 120/80.', v_visit_record_id)
  ON CONFLICT (id) DO NOTHING;

  -- Flu shot done 2025-10-01
  INSERT INTO public.checkup_completions (id, checkup_item_id, done_at, note)
  VALUES ('20000001-0000-4000-8000-000000000003', v_item_flu_id, '2025-10-01', 'No adverse reactions.')
  ON CONFLICT (id) DO NOTHING;

  -- Demi vet + rabies done 2025-08-10
  INSERT INTO public.checkup_completions (id, checkup_item_id, done_at, note)
  VALUES ('20000001-0000-4000-8000-000000000004', v_item_demi_vet_id, '2025-08-10', 'Healthy.')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.checkup_completions (id, checkup_item_id, done_at, note)
  VALUES ('20000001-0000-4000-8000-000000000005', v_item_demi_rabies_id, '2025-08-10', 'Rabies + DHPP.')
  ON CONFLICT (id) DO NOTHING;
END $$;

-- ============================================================================
-- MED REGIMENS (regular meds for dashboard / reminder debug)
-- ============================================================================
-- Dose events are generated by generate_med_dose_events_for_horizon (cron or debug).
DO $$
DECLARE
  v_max_person_id uuid;
  v_reg_vitamin_d uuid := '30000001-0000-4000-8000-000000000001';
  v_reg_omega3 uuid := '30000001-0000-4000-8000-000000000002';
  v_reg_multivitamin uuid := '30000001-0000-4000-8000-000000000003';
  v_reg_magnesium uuid := '30000001-0000-4000-8000-000000000004';
BEGIN
  SELECT id INTO v_max_person_id FROM public.persons WHERE name = 'Max' LIMIT 1;

  IF v_max_person_id IS NOT NULL THEN
    -- Vitamin D3 — 08:00 daily (same slot as Omega-3 for "Confirm all")
    INSERT INTO public.med_regimens (
      id, person_id, custom_name, status, intake_unit, dose_definition,
      intake_advice_type, schedule, duration, inventory
    ) VALUES (
      v_reg_vitamin_d,
      v_max_person_id,
      'Vitamin D3',
      'active',
      'pill',
      '{"intake": {"amount": 1, "unit": "pill"}, "active": [{"name": "Vitamin D", "amount": 2000, "unit": "IU"}]}'::jsonb,
      'with_meal',
      '{"mode": "daily_times", "times": ["08:00"]}'::jsonb,
      '{"type": "endless"}'::jsonb,
      NULL
    ) ON CONFLICT (id) DO NOTHING;

    -- Omega-3 — 08:00 daily (grouped with Vitamin D)
    INSERT INTO public.med_regimens (
      id, person_id, custom_name, status, intake_unit, dose_definition,
      intake_advice_type, schedule, duration, inventory
    ) VALUES (
      v_reg_omega3,
      v_max_person_id,
      'Omega-3',
      'active',
      'pill',
      '{"intake": {"amount": 1, "unit": "pill"}, "active": [{"name": "Omega-3", "amount": 1000, "unit": "mg"}]}'::jsonb,
      'with_meal',
      '{"mode": "daily_times", "times": ["08:00"]}'::jsonb,
      '{"type": "endless"}'::jsonb,
      NULL
    ) ON CONFLICT (id) DO NOTHING;

    -- Multivitamin — 12:00 daily
    INSERT INTO public.med_regimens (
      id, person_id, custom_name, status, intake_unit, dose_definition,
      intake_advice_type, schedule, duration, inventory
    ) VALUES (
      v_reg_multivitamin,
      v_max_person_id,
      'Multivitamin',
      'active',
      'pill',
      '{"intake": {"amount": 1, "unit": "pill"}, "active": []}'::jsonb,
      'with_meal',
      '{"mode": "daily_times", "times": ["12:00"]}'::jsonb,
      '{"type": "endless"}'::jsonb,
      NULL
    ) ON CONFLICT (id) DO NOTHING;

    -- Magnesium — 21:00 daily
    INSERT INTO public.med_regimens (
      id, person_id, custom_name, status, intake_unit, dose_definition,
      intake_advice_type, schedule, duration, inventory
    ) VALUES (
      v_reg_magnesium,
      v_max_person_id,
      'Magnesium',
      'active',
      'pill',
      '{"intake": {"amount": 1, "unit": "pill"}, "active": [{"name": "Magnesium", "amount": 400, "unit": "mg"}]}'::jsonb,
      'before_bed',
      '{"mode": "daily_times", "times": ["21:00"]}'::jsonb,
      '{"type": "endless"}'::jsonb,
      NULL
    ) ON CONFLICT (id) DO NOTHING;
  END IF;
END $$;

-- ============================================================================
-- NOTES
-- ============================================================================
-- 1. Auth users are created directly in the seed file, allowing us to reference
--    their IDs in other tables immediately.
--
-- 2. Allowed users are linked to auth users via auth_user_id. The trigger
--    link_allowed_user() will also handle linking if a user signs in with
--    a matching email.
--
-- 3. Persons can be linked to users via auth_user_id. Max is linked to
--    the Google OAuth user account.
--
-- 4. This seed file uses ON CONFLICT DO NOTHING/UPDATE to allow safe re-runs
--    during development. Remove conflicts if you want fresh data on each reset.
--
-- 5. Current user reference:
--    - Email: dev@example.com
--    - Auth User ID: 00000000-0000-4000-8000-000000000001
--    - Name: Dev User
--
-- 6. Sample medical records are created for all persons to demonstrate the
--    health records feature. Records include various types: lab, visit,
--    vaccination, imaging, and vet visits.
--
-- 7. Sample measurements are created for Max to demonstrate the measurements
--    tracking feature with historical data for charts.
--
-- 8. Record observations (lab values) are added to Max's blood test record
--    (Annual Blood Test Results) for debugging the observations UI.
--
-- 9. Record findings are added to Kate's imaging record (Dental X-Ray) for
--    debugging the findings UI (polyp in sigmoid colon, cyst in left kidney).
--
-- 10. Conditions and condition_records are added for Max (B12 deficiency,
--     hypertension, allergic rhinitis) and linked to his blood test and
--     visit records for debugging the conditions UI.
--
-- 11. Checkups: checkup_items and checkup_completions for Max, Kate, and Demi
--     (annual blood work, annual physical, flu shot, dental cleaning, vet +
--     rabies). Some items have why_links to conditions; some have completions
--     with evidence_record_id pointing to medical_records. Re-run safe via
--     ON CONFLICT (id) DO NOTHING.
--
-- 12. Med regimens: four regular regimens for Max (Vitamin D3, Omega-3, Multivitamin,
--     Magnesium) with times 08:00, 08:00, 12:00, 21:00 for dashboard and "Confirm all"
--     (08:00 group) debugging. Dose events are generated by run-cron or event generator.
--     Fixed UUIDs, ON CONFLICT (id) DO NOTHING.
--
-- 13. Notifications cron: base URL for Edge Functions (local only; seed runs on db reset).
--     Sets vault secret project_url to http://kong:8000 so pg_cron + pg_net can call
--     the notifications-cron Edge Function from inside Docker. Idempotent: only creates
--     if no secret with name project_url exists (avoids duplicates on re-seed).

-- ============================================================================
-- NOTIFICATIONS CRON (local): project_url for pg_net
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'project_url' LIMIT 1) THEN
    PERFORM vault.create_secret('http://kong:8000', 'project_url');
  END IF;
END
$$;