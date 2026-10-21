-- Lite tick: Supabase calls the dashboard every minute (free plan scheduler).
-- Paste on launch day AFTER the dashboard is deployed (step 15).
-- Replace <CRON_SECRET> below in the SQL editor only; never commit it.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Store or rotate the secret in Vault.
DO $$
DECLARE
  v_id uuid;
BEGIN
  SELECT id INTO v_id FROM vault.secrets WHERE name = 'workwise_cron_secret';
  IF v_id IS NULL THEN
    PERFORM vault.create_secret('<CRON_SECRET>', 'workwise_cron_secret', 'CRON_SECRET for /api/cron/* calls from pg_cron');
  ELSE
    PERFORM vault.update_secret(v_id, '<CRON_SECRET>');
  END IF;
END $$;

-- (Re)create the job: unschedule first so running this twice never makes two jobs.
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'workwise-lite-tick';

SELECT cron.schedule(
  'workwise-lite-tick',
  '* * * * *',
  $job$
    SELECT net.http_get(
      url := 'https://app.joinworkwise.com/api/cron/lite-tick',
      headers := jsonb_build_object(
        'x-workwise-cron-secret',
        (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'workwise_cron_secret')
      ),
      timeout_milliseconds := 55000
    );
  $job$
);

-- Check: one row, active.
SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = 'workwise-lite-tick';
