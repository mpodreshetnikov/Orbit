-- ============================================================================
-- PUBLIC STORAGE BUCKET FOR CHROME EXTENSION RELEASES
-- ============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'extension-releases',
  'extension-releases',
  true,
  52428800, -- 50 MiB in bytes
  ARRAY['application/zip', 'application/json']
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;
