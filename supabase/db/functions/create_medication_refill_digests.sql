-- Function: create_medication_refill_digests()
-- Create refill notification_digests for low-stock regimens

CREATE OR REPLACE FUNCTION public.create_medication_refill_digests(p_auth_user_id uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_person_ids uuid[];
  v_today date;
  v_inserted int := 0;
  v_reg record;
  v_rec record;
  v_prefix text;
  v_tz text;
BEGIN
  SELECT array_agg(DISTINCT src.person_id) INTO v_person_ids
  FROM (
    SELECT p.id AS person_id
    FROM public.persons p
    WHERE p.auth_user_id = p_auth_user_id
    UNION
    SELECT r.person_id
    FROM public.notification_routing r
    WHERE r.recipient_user_id = p_auth_user_id
      AND r.enabled = true
  ) AS src;

  IF v_person_ids IS NULL OR array_length(v_person_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  SELECT COALESCE(NULLIF(TRIM(up.checkup_notification_timezone), ''), 'UTC')
  INTO v_tz
  FROM public.user_preferences up
  WHERE up.auth_user_id = p_auth_user_id;

  v_tz := COALESCE(NULLIF(TRIM(v_tz), ''), 'UTC');
  v_today := (now() AT TIME ZONE v_tz)::date;

  FOR v_reg IN
    SELECT
      r.id,
      r.custom_name,
      r.inventory,
      r.person_id,
      p.name AS person_name,
      p.auth_user_id AS person_owner_user_id
    FROM public.med_regimens r
    JOIN public.persons p ON p.id = r.person_id
    LEFT JOIN public.medication_refill_snoozes s
      ON s.regimen_id = r.id
     AND s.recipient_user_id = p_auth_user_id
    WHERE r.person_id = ANY(v_person_ids)
      AND (r.deleted_at IS NULL)
      AND r.status = 'active'
      AND r.inventory IS NOT NULL
      AND (r.inventory->>'enabled')::boolean IS TRUE
      AND (r.inventory->>'current_amount')::numeric IS NOT NULL
      AND (r.inventory->>'refill_threshold_amount')::numeric IS NOT NULL
      AND (r.inventory->>'current_amount')::numeric <= (r.inventory->>'refill_threshold_amount')::numeric
      AND (s.snooze_until IS NULL OR s.snooze_until < v_today)
  LOOP
    FOR v_rec IN
      SELECT r.recipient_user_id, r.custom_prefix, v_reg.person_name AS person_name, v_reg.person_owner_user_id AS person_owner_user_id
      FROM public.notification_routing r
      WHERE r.person_id = v_reg.person_id
        AND r.enabled = true
      UNION ALL
      SELECT p.auth_user_id AS recipient_user_id, NULL::text AS custom_prefix, v_reg.person_name AS person_name, v_reg.person_owner_user_id AS person_owner_user_id
      FROM public.persons p
      WHERE p.id = v_reg.person_id
        AND p.auth_user_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM public.notification_routing r2
          WHERE r2.recipient_user_id = p.auth_user_id
            AND r2.person_id = p.id
        )
    LOOP
      IF v_rec.person_owner_user_id = v_rec.recipient_user_id THEN
        v_prefix := NULL;
      ELSE
        v_prefix := COALESCE(NULLIF(TRIM(v_rec.custom_prefix), ''), v_rec.person_name);
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM public.notification_digests d
        WHERE d.auth_user_id = v_rec.recipient_user_id
          AND d.person_id = v_reg.person_id
          AND d.type = 'medication_refill'
          AND (d.payload_json->>'regimen_id') = v_reg.id::text
          AND d.scheduled_at::date = v_today
          AND d.sent_at IS NULL
      ) THEN
        INSERT INTO public.notification_digests (
          auth_user_id,
          person_id,
          type,
          scheduled_at,
          payload_json
        ) VALUES (
          v_rec.recipient_user_id,
          v_reg.person_id,
          'medication_refill',
          now(),
          jsonb_build_object(
            'title', 'Medications',
            'body', 'Low stock: ' || v_reg.custom_name,
            'url', '/health/medications',
            'regimen_id', v_reg.id,
            'person_id', v_reg.person_id,
            'person_name', v_reg.person_name,
            'title_prefix', v_prefix
          )
        );
        v_inserted := v_inserted + 1;
      END IF;
    END LOOP;
  END LOOP;

  RETURN v_inserted;
END;
$$;

COMMENT ON FUNCTION public.create_medication_refill_digests(uuid) IS
  'Create refill notification_digests for low-stock regimens for all routed recipients (including implicit own person). Only active, non-deleted regimens.';
