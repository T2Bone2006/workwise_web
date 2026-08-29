-- Which imported spreadsheet columns a customer's workers see on the job
-- screen, and what they are called there.
--
-- Shape: an ordered array, order being display order on the phone.
--
--   [{ "key": "locktype",            -- canonical: lowercased, punctuation stripped
--      "source_header": "LOCK_TYPE", -- last-seen spelling, shown in the dashboard
--      "label": "Lock type",         -- what the worker reads
--      "enabled": true }]
--
-- Disabled entries are kept rather than removed so a label edit survives being
-- switched off and back on.
--
-- NULL means never configured, which shows every field. Matching against the
-- canonical key happens when a job is read, so `jobs.source_fields` keeps the
-- original headers and nothing already imported needs backfilling.
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS worker_visible_fields jsonb;

COMMENT ON COLUMN public.customers.worker_visible_fields IS
  'Ordered per-customer config for the worker app job sheet. NULL = show every imported field.';
