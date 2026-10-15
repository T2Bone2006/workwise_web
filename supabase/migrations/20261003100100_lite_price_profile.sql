-- Phase 6 migration 2: the set-up interview (D3) and the finished price profile (T18/T19).
-- Admin of the tenant may read; only server code (service role) writes.

CREATE TABLE IF NOT EXISTS public.lite_interviews (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'in_progress',
  stage text NOT NULL DEFAULT 'areas',
  messages jsonb NOT NULL DEFAULT '[]'::jsonb,
  draft_profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  example_jobs jsonb NOT NULL DEFAULT '[]'::jsonb,
  turn_count integer NOT NULL DEFAULT 0,
  started_by_user_id uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  finished_at timestamp with time zone,
  CONSTRAINT lite_interviews_pkey PRIMARY KEY (id),
  CONSTRAINT lite_interviews_tenant_fkey FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  CONSTRAINT lite_interviews_user_fkey FOREIGN KEY (started_by_user_id)
    REFERENCES public.users(id) ON DELETE SET NULL,
  CONSTRAINT lite_interviews_status_check CHECK (status IN ('in_progress', 'finished', 'abandoned')),
  CONSTRAINT lite_interviews_stage_check CHECK (
    stage IN ('areas', 'work', 'pricing', 'rules', 'examples', 'website', 'done')),
  CONSTRAINT lite_interviews_turns_check CHECK (turn_count >= 0 AND turn_count <= 120),
  CONSTRAINT lite_interviews_finished_check CHECK (
    (status = 'finished') = (finished_at IS NOT NULL))
);

-- At most one interview in progress per business.
CREATE UNIQUE INDEX IF NOT EXISTS uq_lite_interviews_one_open
  ON public.lite_interviews (tenant_id) WHERE status = 'in_progress';
CREATE INDEX IF NOT EXISTS idx_lite_interviews_tenant_created
  ON public.lite_interviews (tenant_id, created_at DESC);

DROP TRIGGER IF EXISTS set_lite_interviews_updated_at ON public.lite_interviews;
CREATE TRIGGER set_lite_interviews_updated_at
  BEFORE UPDATE ON public.lite_interviews
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.lite_price_profiles (
  tenant_id uuid NOT NULL,
  profile jsonb NOT NULL,
  version integer NOT NULL DEFAULT 1,
  interview_id uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT lite_price_profiles_pkey PRIMARY KEY (tenant_id),
  CONSTRAINT lite_price_profiles_tenant_fkey FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  CONSTRAINT lite_price_profiles_interview_fkey FOREIGN KEY (interview_id)
    REFERENCES public.lite_interviews(id) ON DELETE SET NULL,
  CONSTRAINT lite_price_profiles_shape_check CHECK (
    jsonb_typeof(profile) = 'object'
    AND jsonb_typeof(profile->'job_types') = 'array'
    AND jsonb_array_length(profile->'job_types') BETWEEN 1 AND 30),
  CONSTRAINT lite_price_profiles_version_check CHECK (version >= 1)
);

DROP TRIGGER IF EXISTS set_lite_price_profiles_updated_at ON public.lite_price_profiles;
CREATE TRIGGER set_lite_price_profiles_updated_at
  BEFORE UPDATE ON public.lite_price_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.lite_interviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lite_price_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "lite_interviews_admin_select" ON public.lite_interviews;
CREATE POLICY "lite_interviews_admin_select" ON public.lite_interviews FOR SELECT TO authenticated
USING (tenant_id IN (SELECT tenant_id FROM public.users WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "lite_price_profiles_admin_select" ON public.lite_price_profiles;
CREATE POLICY "lite_price_profiles_admin_select" ON public.lite_price_profiles FOR SELECT TO authenticated
USING (tenant_id IN (SELECT tenant_id FROM public.users WHERE id = auth.uid() AND role = 'admin'));

REVOKE ALL ON public.lite_interviews, public.lite_price_profiles FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.lite_interviews, public.lite_price_profiles FROM authenticated;
GRANT SELECT ON public.lite_interviews, public.lite_price_profiles TO authenticated;

-- T6: four new AI log types; every existing value is kept.
ALTER TABLE public.ai_interactions DROP CONSTRAINT IF EXISTS ai_interactions_interaction_type_check;
ALTER TABLE public.ai_interactions ADD CONSTRAINT ai_interactions_interaction_type_check CHECK (
  interaction_type = ANY (ARRAY[
    'skill_detection'::text, 'quote_generation'::text, 'column_mapping'::text,
    'worker_interview_parsing'::text, 'value_transformation'::text, 'date_parsing'::text,
    'description_summary'::text, 'row_extraction'::text, 'customer_row_extraction'::text,
    'message_classification'::text, 'receipt_extraction'::text, 'invoice_drafting'::text,
    'widget_chat'::text, 'lite_interview'::text, 'lite_text_draft'::text, 'conversation_summary'::text
  ])
);

COMMENT ON TABLE public.lite_interviews IS
  'Phase 6 set-up interview attempts (D3). messages = [{role, content}]. Redo = a new row (D13).';
COMMENT ON TABLE public.lite_price_profiles IS
  'How the business prices (T19 PriceProfile). Replaced only when an interview finishes. Absent = enquiry mode.';
COMMENT ON COLUMN public.lite_price_profiles.profile IS
  'PriceProfile JSON validated by lib/lite/profile-schema.ts. job_types[].how_priced = from_description | needs_visit (D4).';
