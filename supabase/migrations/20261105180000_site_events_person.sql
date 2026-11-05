-- Follow one visitor across pages, but only for people who pressed Accept on the cookie banner.
-- "person" is a random code held in our own cookie (ww_vid, 30 days). It holds no name, email or
-- IP address and is never linked to a customer record. Events from visitors who did not accept
-- keep person empty and are still counted the cookie-free way.

ALTER TABLE public.site_events ADD COLUMN IF NOT EXISTS person text;

ALTER TABLE public.site_events DROP CONSTRAINT IF EXISTS site_events_person_len;
ALTER TABLE public.site_events
  ADD CONSTRAINT site_events_person_len CHECK (person IS NULL OR char_length(person) <= 40);

COMMENT ON COLUMN public.site_events.person IS
  'Random code from the ww_vid cookie, set only after the visitor accepted cookies. Null for visitors who did not accept.';

CREATE INDEX IF NOT EXISTS idx_site_events_person
  ON public.site_events (person) WHERE person IS NOT NULL;
