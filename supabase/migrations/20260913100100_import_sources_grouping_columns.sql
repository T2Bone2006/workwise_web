-- Which spreadsheet columns identify a job group for this import source.
--
-- Rows whose values match across every listed column are put in one
-- job_groups row at import time (see lib/import/job-grouping.ts). Headers are
-- stored as they appear in the sheet, e.g. ["W/O First Name", "W/O Last Name",
-- "Date Required"], and matched case-insensitively when a later sheet spells
-- them differently.
--
-- NULL = never decided for this source: the wizard asks the AI to suggest
-- columns and the user confirms. [] = the user explicitly chose not to group,
-- which is remembered so they are not asked again.
ALTER TABLE public.import_sources
  ADD COLUMN IF NOT EXISTS grouping_columns jsonb;

COMMENT ON COLUMN public.import_sources.grouping_columns IS
  'Sheet columns whose matching values define a job group. NULL = not yet decided, [] = grouping off.';
