# One-off database scripts

These are not migrations. They are pasted by hand in the Supabase SQL editor. Nothing here belongs in `schema_current.sql`.

## `lite-tick-schedule.sql`

Makes Supabase call `https://app.joinworkwise.com/api/cron/lite-tick` every minute. That sends due Lite follow-up texts (up to 50 a run), gives up on texts stuck in sending, and closes website chats that have been quiet for 20 minutes, writing a one-line summary.

Paste it only after the dashboard is live. In the SQL editor, replace both `<CRON_SECRET>` placeholders with the **Production** `CRON_SECRET` from the Vercel project **workwise-web**. Do that in the editor only. Do not save the filled-in script, and do not commit it.

The last query should return one row: job name `workwise-lite-tick`, schedule `* * * * *`, active.

Running the file again replaces that one job and stores the latest secret. It does not create a second job. The secret is read from Vault when the job runs, so it does not appear in `cron.job`.

## Is it running?

Wait three minutes, then run:

```sql
SELECT status, start_time, return_message
FROM cron.job_run_details
WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'workwise-lite-tick')
ORDER BY start_time DESC
LIMIT 10;
```

A healthy run has status `succeeded`. That means Supabase queued the call. The web result arrives just after, in:

```sql
SELECT id, status_code, error_msg, timed_out, left(content, 200) AS content, created
FROM net._http_response
ORDER BY created DESC
LIMIT 10;
```

`net._http_response` does not store the address. These are the latest calls. Healthy is HTTP **200** about once a minute, and `content` starts with `{"stuck"`. **401** means the secret in Vault does not match Production `CRON_SECRET`. Paste `lite-tick-schedule.sql` again with the right value. Texts do not send on a 401.

`net._http_response` only keeps rows for about six hours.

## `lite-tick-unschedule.sql`

Stops the calls within a minute. The Vault secret and the two extensions stay. The check query should return zero rows.

On the laptop nothing is scheduled. `npm run lite:tick` still does this job there, and it refuses to point at the live site.
