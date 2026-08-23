-- Function: create_money_import_stale_digests(integer)
-- Remind the owner when money import has not completed a run in a while.
--
-- The signal is the last **successfully completed import run**, not the newest transaction.
-- The obvious alternative — max(posted_at) — measures spending, not whether import works, and
-- it is wrong in both directions: a quiet week of no spending would produce a false reminder,
-- and a bank that went silent looks exactly like an extension that stopped running.
--
-- Active accounts decide which person/source pairs are watched at all. A source with no
-- active account is one the person no longer uses, and reminding about it is noise.

CREATE OR REPLACE FUNCTION public.create_money_import_stale_digests(
  p_stale_days integer DEFAULT 5
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_stale_days integer := GREATEST(1, COALESCE(p_stale_days, 5));
  v_threshold timestamptz := now() - make_interval(days => GREATEST(1, COALESCE(p_stale_days, 5)));
  v_inserted integer := 0;
  v_rec record;
BEGIN
  FOR v_rec IN
    SELECT
      watched.person_id,
      watched.source,
      watched.recipient_user_id,
      watched.person_name,
      last_run.completed_at AS last_completed_at
    FROM (
      SELECT DISTINCT
        account.owner_person_id AS person_id,
        account.source,
        person.name AS person_name,
        COALESCE(
          person.auth_user_id,
          (
            SELECT routing.recipient_user_id
            FROM public.notification_routing AS routing
            WHERE routing.person_id = account.owner_person_id
              AND routing.enabled = true
            ORDER BY routing.created_at, routing.id
            LIMIT 1
          )
        ) AS recipient_user_id
      FROM public.money_accounts AS account
      JOIN public.persons AS person ON person.id = account.owner_person_id
      WHERE account.is_active
    ) AS watched
    LEFT JOIN LATERAL (
      SELECT max(batch.completed_at) AS completed_at
      FROM public.money_import_batches AS batch
      WHERE batch.payer_person_id = watched.person_id
        AND batch.source = watched.source
        AND batch.status = 'completed'
    ) AS last_run ON true
    WHERE watched.recipient_user_id IS NOT NULL
      AND (last_run.completed_at IS NULL OR last_run.completed_at < v_threshold)
  LOOP
    -- One reminder per person and source per staleness window: repeating it daily would
    -- train the owner to ignore it, which is worse than not sending it at all.
    IF NOT EXISTS (
      SELECT 1
      FROM public.notification_digests AS digest
      WHERE digest.auth_user_id = v_rec.recipient_user_id
        AND digest.person_id = v_rec.person_id
        AND digest.type = 'money_import_stale'
        AND (digest.payload_json->>'source') = v_rec.source
        AND digest.scheduled_at >= v_threshold
    ) THEN
      INSERT INTO public.notification_digests (
        auth_user_id,
        person_id,
        type,
        scheduled_at,
        payload_json
      ) VALUES (
        v_rec.recipient_user_id,
        v_rec.person_id,
        'money_import_stale',
        now(),
        jsonb_build_object(
          'title', 'Money',
          'body', 'No completed import from ' || v_rec.source || ' in the last ' || v_stale_days || ' days',
          'url', '/money/import',
          'source', v_rec.source,
          'person_id', v_rec.person_id,
          'person_name', v_rec.person_name,
          'stale_days', v_stale_days,
          'last_completed_at', v_rec.last_completed_at
        )
      );
      v_inserted := v_inserted + 1;
    END IF;
  END LOOP;

  RETURN v_inserted;
END;
$$;

COMMENT ON FUNCTION public.create_money_import_stale_digests(integer) IS
  'Create money_import_stale digests for person/source pairs with an active account whose last completed import run is older than p_stale_days.';
