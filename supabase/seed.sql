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
INSERT INTO public.persons (name, kind, birthday, auth_user_id) VALUES
  ('Max', 'human', '2001-01-24', '00000000-0000-4000-8000-000000000001'),
  ('Kate', 'human', '1998-08-14', NULL)
ON CONFLICT DO NOTHING;

-- Pet family members
INSERT INTO public.persons (name, kind, species, birthday) VALUES
  ('Demi', 'pet', 'dog', NULL)
ON CONFLICT DO NOTHING;

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
