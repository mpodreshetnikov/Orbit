-- ============================================================================
-- LET THE EXTENSION RELEASE BUCKET HOLD THE SIGNED FIREFOX ADD-ON
-- ============================================================================
-- Firefox offers to install an add-on a page links to only when it is served as
-- application/x-xpinstall; as anything else the click downloads the file. The
-- bucket's list is an exact match, so the type has to be on it. T-261021-phi.

UPDATE storage.buckets
SET allowed_mime_types = ARRAY['application/zip', 'application/json', 'application/x-xpinstall']
WHERE id = 'extension-releases';
