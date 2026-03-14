-- Idempotent storage bucket definitions.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'medical-attachments',
  'medical-attachments',
  false,
  20971520,
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'extension-releases',
  'extension-releases',
  true,
  52428800,
  ARRAY['application/zip', 'application/json']
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Policies for storage.objects (medical-attachments bucket)

DROP POLICY IF EXISTS "storage_medical_attachments_insert" ON storage.objects;
CREATE POLICY "storage_medical_attachments_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'medical-attachments'
    AND public.is_allowed_user()
  );

DROP POLICY IF EXISTS "storage_medical_attachments_select" ON storage.objects;
CREATE POLICY "storage_medical_attachments_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'medical-attachments'
    AND public.is_allowed_user()
  );

DROP POLICY IF EXISTS "storage_medical_attachments_update" ON storage.objects;
CREATE POLICY "storage_medical_attachments_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'medical-attachments'
    AND public.is_allowed_user()
  )
  WITH CHECK (
    bucket_id = 'medical-attachments'
    AND public.is_allowed_user()
  );

DROP POLICY IF EXISTS "storage_medical_attachments_delete" ON storage.objects;
CREATE POLICY "storage_medical_attachments_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'medical-attachments'
    AND public.is_allowed_user()
  );
