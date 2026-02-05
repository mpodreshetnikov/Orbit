-- Trigger: update_record_findings_updated_at
-- Auto-update updated_at timestamp on record_findings table

DROP TRIGGER IF EXISTS update_record_findings_updated_at ON public.record_findings;
CREATE TRIGGER update_record_findings_updated_at
  BEFORE UPDATE ON public.record_findings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
