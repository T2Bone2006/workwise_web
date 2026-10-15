-- Shared starter packs (Window cleaning, Gardening, …). Every business can
-- read them. Adding a pack copies the rows into that business's service_catalog.
-- A name they already have is left alone, so an edited price is not overwritten.

CREATE TABLE IF NOT EXISTS public.service_preset_groups (
  key text NOT NULL,
  label text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  CONSTRAINT service_preset_groups_pkey PRIMARY KEY (key)
);

CREATE TABLE IF NOT EXISTS public.service_presets (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  group_key text NOT NULL,
  name text NOT NULL,
  default_price numeric(10,2) NOT NULL,
  default_duration_minutes integer NOT NULL DEFAULT 30,
  default_frequency_days integer,
  sort_order integer NOT NULL DEFAULT 0,
  CONSTRAINT service_presets_pkey PRIMARY KEY (id),
  CONSTRAINT service_presets_group_key_fkey FOREIGN KEY (group_key)
    REFERENCES public.service_preset_groups(key) ON DELETE CASCADE,
  CONSTRAINT service_presets_group_name_key UNIQUE (group_key, name),
  CONSTRAINT service_presets_price_check CHECK (default_price >= 0),
  CONSTRAINT service_presets_duration_check CHECK (default_duration_minutes > 0),
  CONSTRAINT service_presets_frequency_check CHECK (
    default_frequency_days IS NULL OR default_frequency_days BETWEEN 1 AND 365
  )
);

COMMENT ON TABLE public.service_preset_groups IS
  'Shared trade packs. Tenants copy these into service_catalog.';
COMMENT ON TABLE public.service_presets IS
  'Starter services inside a trade pack. Defaults only.';

CREATE INDEX IF NOT EXISTS idx_service_presets_group_key
  ON public.service_presets (group_key, sort_order);

ALTER TABLE public.service_preset_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_presets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_preset_groups_read" ON public.service_preset_groups;
CREATE POLICY "service_preset_groups_read"
ON public.service_preset_groups FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS "service_presets_read" ON public.service_presets;
CREATE POLICY "service_presets_read"
ON public.service_presets FOR SELECT
TO authenticated
USING (true);

INSERT INTO public.service_preset_groups (key, label, sort_order) VALUES
  ('window_cleaning', 'Window cleaning', 1),
  ('gardening', 'Gardening', 2),
  ('cleaning', 'Cleaning', 3),
  ('exterior', 'Exterior', 4),
  ('general', 'General', 5)
ON CONFLICT (key) DO UPDATE
SET label = EXCLUDED.label, sort_order = EXCLUDED.sort_order;

INSERT INTO public.service_presets
  (group_key, name, default_price, default_duration_minutes, default_frequency_days, sort_order)
VALUES
  ('window_cleaning', 'Window clean (front)', 12, 20, 28, 1),
  ('window_cleaning', 'Window clean (front & back)', 18, 30, 28, 2),
  ('window_cleaning', 'Conservatory roof', 40, 60, 91, 3),
  ('window_cleaning', 'Gutter clear', 60, 60, 365, 4),
  ('window_cleaning', 'Fascia & soffit clean', 45, 45, 365, 5),
  ('window_cleaning', 'Solar panel clean', 50, 60, 182, 6),
  ('gardening', 'Lawn cut', 25, 45, 14, 1),
  ('gardening', 'Hedge trim', 40, 60, 56, 2),
  ('gardening', 'Garden tidy', 35, 60, 28, 3),
  ('cleaning', 'Oven clean', 55, 90, 91, 1),
  ('cleaning', 'Carpet clean (room)', 35, 60, 182, 2),
  ('cleaning', 'Domestic clean', 45, 120, 7, 3),
  ('exterior', 'Driveway pressure wash', 120, 180, 365, 1),
  ('exterior', 'Patio pressure wash', 90, 120, 365, 2),
  ('exterior', 'Wheelie bin clean', 5, 10, 14, 3),
  ('general', 'Call-out', 40, 60, NULL, 1),
  ('general', 'Maintenance visit', 50, 60, 28, 2)
ON CONFLICT (group_key, name) DO UPDATE
SET
  default_price = EXCLUDED.default_price,
  default_duration_minutes = EXCLUDED.default_duration_minutes,
  default_frequency_days = EXCLUDED.default_frequency_days,
  sort_order = EXCLUDED.sort_order;
