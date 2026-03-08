-- Recipient-specific snooze state for low-stock medication refill reminders.

CREATE TABLE IF NOT EXISTS public.medication_refill_snoozes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  regimen_id uuid NOT NULL REFERENCES public.med_regimens(id) ON DELETE CASCADE,
  snooze_until date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (recipient_user_id, regimen_id)
);

CREATE INDEX IF NOT EXISTS idx_medication_refill_snoozes_recipient
  ON public.medication_refill_snoozes(recipient_user_id);

CREATE INDEX IF NOT EXISTS idx_medication_refill_snoozes_regimen
  ON public.medication_refill_snoozes(regimen_id);

ALTER TABLE public.medication_refill_snoozes ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.medication_refill_snoozes IS
  'Recipient-specific snooze dates for low-stock medication refill reminders.';
