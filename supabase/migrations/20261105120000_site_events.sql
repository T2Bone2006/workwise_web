-- Cookie-free visitor counts for joinworkwise.com and the sign-up pages.
-- One row per thing that happened (a page was opened, someone scrolled, pressed a button, left).
-- No IP address, no cookie, no device ID is stored. "visit" is a random code made fresh on every
-- page load and held in the browser's memory only, so it joins one page's events together and
-- can never follow a person from page to page or day to day.
-- Written only by the /api/public/track route with the service role, and read only by the admin
-- page /admin/website. No row-level policies and nothing a customer can read or change.

CREATE TABLE IF NOT EXISTS public.site_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  visit text NOT NULL,
  kind text NOT NULL,
  page text NOT NULL,
  ad_source text,
  ad_content text,
  detail text,
  value integer,
  CONSTRAINT site_events_kind_check
    CHECK (kind IN ('view', 'scroll', 'click', 'leave', 'signup')),
  CONSTRAINT site_events_visit_len CHECK (char_length(visit) <= 40),
  CONSTRAINT site_events_page_len CHECK (char_length(page) <= 120),
  CONSTRAINT site_events_detail_len CHECK (detail IS NULL OR char_length(detail) <= 120)
);

COMMENT ON TABLE public.site_events IS
  'Cookie-free funnel events from the marketing site and sign-up pages. kind: view = page opened, scroll = reached value% of the page, click = pressed something (detail says what), leave = left after value seconds on the page, signup = a sign-up step (detail = plan, details, submitted).';

CREATE INDEX IF NOT EXISTS idx_site_events_created_at ON public.site_events (created_at DESC);

ALTER TABLE public.site_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.site_events FROM anon, authenticated;
