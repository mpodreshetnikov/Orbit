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
