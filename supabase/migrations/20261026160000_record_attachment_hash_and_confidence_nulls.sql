-- T-261026-dku: a duplicate page is reported by its content, and a confidence nobody gave is not
-- a confidence of zero.

-- 1. The SHA-256 of a page's file, as the client that uploaded it computed it. Pages uploaded
--    before this column, or by a client that did not say, keep NULL and are simply not compared.
ALTER TABLE public.record_attachments
  ADD COLUMN IF NOT EXISTS content_sha256 text;

DO $$
BEGIN
  ALTER TABLE public.record_attachments
    ADD CONSTRAINT record_attachments_content_sha256_format_check
    CHECK (content_sha256 IS NULL OR content_sha256 ~ '^[0-9a-f]{64}$');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

COMMENT ON COLUMN public.record_attachments.content_sha256 IS
  'Lower-case hex SHA-256 of the page file, given by the uploading client. Used to report a document brought in twice; NULL when not given.';

CREATE INDEX IF NOT EXISTS idx_record_attachments_content_sha256
  ON public.record_attachments(content_sha256)
  WHERE content_sha256 IS NOT NULL;

-- 2. An extraction that left confidence out was stored as 0, which reads as "certainly wrong"
--    rather than "not said". The MCP ingest now requires it; the zeros already stored become NULL.
UPDATE public.record_observations SET confidence = NULL WHERE confidence = 0;
UPDATE public.record_findings SET confidence = NULL WHERE confidence = 0;
UPDATE public.condition_records SET confidence = NULL WHERE confidence = 0;
