-- Let the database name the issuer of an import grant, instead of the browser telling it.
--
-- The insert policy already requires `created_by_auth_user_id = auth.uid()`, so the client had no
-- freedom here to begin with -- it could only send the one value the policy would accept, and to
-- learn that value it had to ask `/auth/v1/user` over the network first. That round trip was pure
-- overhead on every issue, and it was in front of the one operation on this screen that must not
-- get stuck: the key exists in the browser's memory and nowhere else until the row lands.
--
-- With the default, the column is filled from the request's own JWT. The policy is unchanged and
-- still rejects an explicitly supplied id that is not the caller's, so this narrows what the
-- client can say rather than widening it.
ALTER TABLE public.money_import_grants
  ALTER COLUMN created_by_auth_user_id SET DEFAULT auth.uid();
