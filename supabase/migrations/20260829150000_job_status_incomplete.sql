-- A worker can finish their attempt without finishing the work: they walked
-- away, or answered "no" to "job completed?". Those jobs were being written as
-- 'completed', which hid them from the office. 'paused' is wrong too — that
-- means coming back, and these often need re-planning or a new job entirely.
--
-- Adding the enum value has to stand alone. Postgres will not let a new enum
-- value be added and then used inside the same transaction, and Supabase wraps
-- each migration file in one — so the trigger that writes this value lives in
-- the next migration, not here.
ALTER TYPE public.job_status ADD VALUE IF NOT EXISTS 'incomplete';
