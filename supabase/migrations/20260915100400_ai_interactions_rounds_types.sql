-- Rounds AI call types. customer_row_extraction is used by the Phase 1
-- customer/agreement import; the other three land in Phases 2, 3 and 5.
-- Old types stay allowed so historic rows remain valid.
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
        'description_summary'::text,
        'row_extraction'::text,
        'customer_row_extraction'::text,
        'message_classification'::text,
        'receipt_extraction'::text,
        'invoice_drafting'::text
      ]
    )
  );
