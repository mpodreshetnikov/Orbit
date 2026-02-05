-- Deploy version stamp
-- Records Git SHA and timestamp for each deployment

CREATE TABLE IF NOT EXISTS public.db_deploy_log (
  id serial PRIMARY KEY,
  deployed_at timestamptz DEFAULT now(),
  git_sha text,
  deployer text DEFAULT current_user
);

-- RLS: no policies = no access for authenticated/anon; only service_role (bypasses RLS) can read
ALTER TABLE public.db_deploy_log ENABLE ROW LEVEL SECURITY;

-- Insert deployment record (GIT_SHA passed via psql -v)
INSERT INTO public.db_deploy_log (git_sha)
VALUES (:'GIT_SHA');
