-- ============================================================================
-- Enable Supabase Realtime for medical_records table
-- This allows clients to subscribe to changes via websocket instead of polling
-- ============================================================================

-- Enable realtime for medical_records table
ALTER PUBLICATION supabase_realtime ADD TABLE public.medical_records;

-- Set replica identity to full for proper change detection
-- This ensures we get both old and new values in UPDATE events
ALTER TABLE public.medical_records REPLICA IDENTITY FULL;
