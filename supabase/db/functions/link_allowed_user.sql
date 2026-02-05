-- Function: link_allowed_user()
-- Trigger function to link auth_user_id when user signs in

CREATE OR REPLACE FUNCTION public.link_allowed_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.allowed_users
  SET auth_user_id = NEW.id
  WHERE email = NEW.email AND auth_user_id IS NULL;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.link_allowed_user() IS
  'Trigger function: links auth_user_id in allowed_users when a new user signs up, if pre-approved by email.';
