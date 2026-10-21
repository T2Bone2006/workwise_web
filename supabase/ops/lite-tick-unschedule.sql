-- Stop the Lite tick. Leaves the Vault secret and the pg_cron / pg_net extensions.

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'workwise-lite-tick';

-- Check: zero rows.
SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = 'workwise-lite-tick';
