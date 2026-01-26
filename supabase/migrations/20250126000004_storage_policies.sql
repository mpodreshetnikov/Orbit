-- ============================================================================
-- STORAGE BUCKET POLICIES FOR MEDICAL ATTACHMENTS
-- ============================================================================
-- Note: The bucket is created via config.toml, this just adds the policies

-- Insert bucket if it doesn't exist (for production deployments)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'medical-attachments',
  'medical-attachments',
  false,
  20971520, -- 20MB in bytes
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- Policy: Allowed users can upload files to medical-attachments bucket
-- Path format: {person_id}/{record_id}/{filename}
CREATE POLICY "Allowed users can upload medical attachments"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'medical-attachments'
  AND EXISTS (
    SELECT 1 FROM public.allowed_users au
    WHERE au.auth_user_id = auth.uid() OR au.email = auth.email()
  )
);

-- Policy: Allowed users can read medical attachments
CREATE POLICY "Allowed users can read medical attachments"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'medical-attachments'
  AND EXISTS (
    SELECT 1 FROM public.allowed_users au
    WHERE au.auth_user_id = auth.uid() OR au.email = auth.email()
  )
);

-- Policy: Allowed users can update medical attachments
CREATE POLICY "Allowed users can update medical attachments"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'medical-attachments'
  AND EXISTS (
    SELECT 1 FROM public.allowed_users au
    WHERE au.auth_user_id = auth.uid() OR au.email = auth.email()
  )
)
WITH CHECK (
  bucket_id = 'medical-attachments'
  AND EXISTS (
    SELECT 1 FROM public.allowed_users au
    WHERE au.auth_user_id = auth.uid() OR au.email = auth.email()
  )
);

-- Policy: Allowed users can delete medical attachments
CREATE POLICY "Allowed users can delete medical attachments"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'medical-attachments'
  AND EXISTS (
    SELECT 1 FROM public.allowed_users au
    WHERE au.auth_user_id = auth.uid() OR au.email = auth.email()
  )
);
