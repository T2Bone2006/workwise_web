-- Map positions for the business "Test rounds 2" (Rounds map page).
--
-- The look-test customers were seeded without map positions and a few of the
-- older demo ones sit in odd places (SW1A 1AA, Ireland), so the new Map page
-- would show 40 customers missing and a heatmap stretched over the whole UK.
-- This moves EVERY agreement of this business into four neighbourhoods around
-- Leeds (Leeds centre, Harrogate side, Wakefield side, Otley side), spread out
-- with a little deterministic jitter so the heatmap and outline have something
-- to show.
--
-- SAFE BY DESIGN
--   * Only the tenant 'Test rounds 2' (id and name both checked, stops with an
--     error otherwise). No other business is touched.
--   * Only lat and lng on service_agreements change. Addresses, postcodes,
--     prices and visits are left alone. Visit rows keep their own copy of
--     lat/lng, so the day plan and routes are unchanged.
--   * Safe to run again: the same agreement always lands on the same spot.
--   * Not undone by the remove file (the old positions were not meaningful).

DO $$
DECLARE
  v_tenant constant uuid := 'f571681c-3054-4836-8086-11c1777fc4ea';
  v_name   text;
  v_count  integer;
BEGIN
  SELECT name INTO v_name FROM public.tenants WHERE id = v_tenant;
  IF v_name IS DISTINCT FROM 'Test rounds 2' THEN
    RAISE EXCEPTION 'Tenant % is not "Test rounds 2" (found: %). Nothing changed.', v_tenant, v_name;
  END IF;

  WITH centres(n, lat, lng) AS (
    VALUES (0, 53.7997, -1.5492), (1, 53.9921, -1.5418), (2, 53.6833, -1.4977), (3, 53.9050, -1.6910)
  ),
  numbered AS (
    SELECT id, (row_number() OVER (ORDER BY id) - 1) % 4 AS n
    FROM public.service_agreements
    WHERE tenant_id = v_tenant
  )
  UPDATE public.service_agreements a
  SET lat = round((c.lat + ((abs(hashtext(a.id::text)) % 1000) / 1000.0 - 0.5) * 0.07)::numeric, 6),
      lng = round((c.lng + ((abs(hashtext(a.id::text || 'x')) % 1000) / 1000.0 - 0.5) * 0.11)::numeric, 6)
  FROM numbered nb
  JOIN centres c ON c.n = nb.n
  WHERE a.id = nb.id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'Moved % agreements onto the map.', v_count;
END $$;
