-- Trigger: on_auth_user_created
-- Auto-link allowed_users when new user is created in auth.users

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.link_allowed_user();
