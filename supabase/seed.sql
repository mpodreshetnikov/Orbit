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