-- Pro job alerts. Paste in the Supabase SQL editor. Do not run from the app.
--
-- When the office sends jobs, each worker can get one email (on unless they
-- turn it off) and, only if they turn it on, one text. Texts come from the
-- sender name WorkWise, not the customer reply number, and they do not use
-- tenant_text_balance (the Rounds / Lite allowance).
--
-- The monthly cap is passed in by the app (starter 250, growth 875, pro 1750)
-- so changing it needs no SQL. One row per business, locked on claim, so two
-- sends at the same moment cannot both take the last text.

ALTER TABLE public.workers
  ADD COLUMN IF NOT EXISTS notify_job_email boolean NOT NULL DEFAULT true;

ALTER TABLE public.workers
  ADD COLUMN IF NOT EXISTS notify_job_sms boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.workers.notify_job_email IS
  'Pro: email this worker when jobs are sent. On unless they turn it off.';
COMMENT ON COLUMN public.workers.notify_job_sms IS
  'Pro: text this worker when jobs are sent. Off until they turn it on.';

CREATE TABLE IF NOT EXISTS public.worker_job_text_balance (
  tenant_id uuid NOT NULL,
  -- 'YYYY-MM' in Europe/London. When it differs from the current month the
  -- next claim resets month_used to 0.
  month text NOT NULL,
  month_used integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT worker_job_text_balance_pkey PRIMARY KEY (tenant_id),
  CONSTRAINT worker_job_text_balance_tenant_id_fkey FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  CONSTRAINT worker_job_text_balance_month_check CHECK (month ~ '^[0-9]{4}-[0-9]{2}$'),
  CONSTRAINT worker_job_text_balance_used_check CHECK (month_used >= 0)
);

DROP TRIGGER IF EXISTS worker_job_text_balance_set_updated_at ON public.worker_job_text_balance;
CREATE TRIGGER worker_job_text_balance_set_updated_at
  BEFORE UPDATE ON public.worker_job_text_balance
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Server only. Workers never read or write this balance.
ALTER TABLE public.worker_job_text_balance ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.worker_job_text_balance FROM PUBLIC, anon, authenticated;

-- Take p_segments (always 1 for a job alert). Returns:
--   'allowance' — they fitted in this month's cap
--   'none'      — the cap is used up; nothing was taken
CREATE OR REPLACE FUNCTION public.claim_worker_job_text(
  p_tenant_id uuid,
  p_segments integer,
  p_allowance integer
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_month text := public.text_month_london();
  v_row public.worker_job_text_balance%ROWTYPE;
  v_from text;
BEGIN
  IF p_segments IS NULL OR p_segments < 1 THEN
    RAISE EXCEPTION 'p_segments must be >= 1';
  END IF;
  IF p_allowance IS NULL OR p_allowance < 0 THEN
    RAISE EXCEPTION 'p_allowance must be >= 0';
  END IF;

  INSERT INTO public.worker_job_text_balance (tenant_id, month)
  VALUES (p_tenant_id, v_month)
  ON CONFLICT (tenant_id) DO NOTHING;

  SELECT * INTO v_row
    FROM public.worker_job_text_balance
   WHERE tenant_id = p_tenant_id
   FOR UPDATE;

  IF v_row.month <> v_month THEN
    v_row.month := v_month;
    v_row.month_used := 0;
  END IF;

  IF v_row.month_used + p_segments <= p_allowance THEN
    v_row.month_used := v_row.month_used + p_segments;
    v_from := 'allowance';
  ELSE
    v_from := 'none';
  END IF;

  UPDATE public.worker_job_text_balance
     SET month = v_row.month,
         month_used = v_row.month_used
   WHERE tenant_id = p_tenant_id;

  RETURN v_from;
END;
$$;

-- Give back a text that never left (the provider refused the send).
-- Only the current London month can be refunded.
CREATE OR REPLACE FUNCTION public.refund_worker_job_text(
  p_tenant_id uuid,
  p_segments integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_segments IS NULL OR p_segments < 1 THEN
    RETURN;
  END IF;

  UPDATE public.worker_job_text_balance
     SET month_used = greatest(month_used - p_segments, 0)
   WHERE tenant_id = p_tenant_id
     AND month = public.text_month_london();
END;
$$;

-- The signed-in worker turns their own email and text alerts on or off.
-- No other column changes.
CREATE OR REPLACE FUNCTION public.set_my_job_alerts(
  p_email boolean,
  p_sms boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not signed in';
  END IF;
  IF p_email IS NULL OR p_sms IS NULL THEN
    RAISE EXCEPTION 'missing';
  END IF;

  UPDATE public.workers
     SET notify_job_email = p_email,
         notify_job_sms = p_sms,
         updated_at = now()
   WHERE user_id = auth.uid();
END;
$$;

REVOKE ALL ON FUNCTION public.claim_worker_job_text(uuid, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refund_worker_job_text(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_my_job_alerts(boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_worker_job_text(uuid, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.refund_worker_job_text(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_my_job_alerts(boolean, boolean) TO authenticated;
