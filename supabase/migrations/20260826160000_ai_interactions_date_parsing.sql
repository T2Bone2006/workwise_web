-- Allow import date-parsing (and future description summaries) on ai_interactions.
ALTER TABLE public.ai_interactions
  DROP CONSTRAINT IF EXISTS ai_interactions_interaction_type_check;

ALTER TABLE public.ai_interactions
  ADD CONSTRAINT ai_interactions_interaction_type_check
  CHECK (
    interaction_type = ANY (
      ARRAY[
        'skill_detection'::text,
        'quote_generation'::text,
        'column_mapping'::text,
        'worker_interview_parsing'::text,
        'value_transformation'::text,
        'date_parsing'::text,
        'description_summary'::text
      ]
    )
  );
