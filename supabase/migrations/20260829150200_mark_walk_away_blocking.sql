-- Turns on the new rule for the report questions that already exist.
--
-- "Did you walk away?" answered yes has always meant the work did not get
-- done; nothing in the data said so. Mark it, and the trigger from the
-- previous migration does the rest.
--
-- Written against the field's id rather than a specific tenant so it applies
-- wherever the question exists, and is a no-op everywhere else. Safe to
-- re-run: a field already marked is left as it is.
UPDATE public.tenants AS t
SET settings = jsonb_set(
      t.settings,
      '{job_report_fields}',
      (
        SELECT jsonb_agg(
          CASE
            WHEN field ->> 'id' = 'walk_away'
              THEN field || '{"blocks_completion": true}'::jsonb
            ELSE field
          END
          ORDER BY ordinality
        )
        FROM jsonb_array_elements(t.settings -> 'job_report_fields')
             WITH ORDINALITY AS elements(field, ordinality)
      )
    )
WHERE jsonb_typeof(t.settings -> 'job_report_fields') = 'array'
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(t.settings -> 'job_report_fields') AS field
    WHERE field ->> 'id' = 'walk_away'
      AND field -> 'blocks_completion' IS DISTINCT FROM 'true'::jsonb
  );
