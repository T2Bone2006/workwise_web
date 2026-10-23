-- Free one-page website for Lite customers.
-- A Lite business is asked once, in the app: "You get a free one-page website. Do you need one?"
-- This table holds the answer and the owner's progress. One row per business, created only when
-- they answer. No row = not asked yet. The owner tracks and updates it on /admin/website.
-- Read and written only by server code with the service role (same as referral_partners), so there
-- are no row-level policies and nothing for a customer to read or change directly.

CREATE TABLE IF NOT EXISTS public.website_requests (
  tenant_id uuid NOT NULL,
  status text NOT NULL,
  live_url text,
  notes text,
  answered_at timestamp with time zone NOT NULL DEFAULT now(),
  done_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT website_requests_pkey PRIMARY KEY (tenant_id),
  CONSTRAINT website_requests_tenant_id_fkey FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  CONSTRAINT website_requests_status_check
    CHECK (status IN ('needs', 'building', 'done', 'has_one', 'taken_down')),
  CONSTRAINT website_requests_live_url_len CHECK (live_url IS NULL OR char_length(live_url) <= 300),
  CONSTRAINT website_requests_notes_len CHECK (notes IS NULL OR char_length(notes) <= 2000)
);

COMMENT ON TABLE public.website_requests IS
  'Free one-page website for Lite customers. Row appears when the customer answers the card. needs = said yes, building = started, done = live, has_one = already has a site, taken_down = left before 12 months so the site was removed.';

CREATE INDEX IF NOT EXISTS idx_website_requests_status ON public.website_requests (status);

DROP TRIGGER IF EXISTS website_requests_set_updated_at ON public.website_requests;
CREATE TRIGGER website_requests_set_updated_at
  BEFORE UPDATE ON public.website_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.website_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.website_requests FROM anon, authenticated;
