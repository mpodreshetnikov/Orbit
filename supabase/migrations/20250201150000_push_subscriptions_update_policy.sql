-- Allow users to update their own push_subscriptions (required for upsert when subscription already exists)
CREATE POLICY "Users can update own push_subscriptions"
  ON public.push_subscriptions FOR UPDATE TO authenticated
  USING (auth_user_id = auth.uid())
  WITH CHECK (auth_user_id = auth.uid());
