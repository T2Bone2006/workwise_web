-- Phase 6 migration 4: remove four tables nothing uses (D15). Paste ONLY after the Phase 6 walkthrough.
-- Fails safe: raises and drops nothing if an AI/metrics table has rows, or a widget_leads row with a
-- business was not copied into leads. No CASCADE: anything still depending on a table stops the drop.

DO $$
DECLARE
  v_count bigint;
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['ai_training_datasets', 'ai_model_performance', 'automation_metrics'] LOOP
    IF to_regclass('public.' || v_table) IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM public.%I', v_table) INTO v_count;
      IF v_count > 0 THEN
        RAISE EXCEPTION 'Stopped: % still has % rows. Nothing was dropped.', v_table, v_count;
      END IF;
    END IF;
  END LOOP;

  IF to_regclass('public.widget_leads') IS NOT NULL THEN
    SELECT count(*) INTO v_count
      FROM public.widget_leads wl
     WHERE wl.tenant_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.leads l WHERE l.source_data->>'widget_lead_id' = wl.id::text)
       AND NOT (wl.conversation_id IS NOT NULL
                AND EXISTS (SELECT 1 FROM public.leads l2 WHERE l2.widget_conversation_id = wl.conversation_id));
    IF v_count > 0 THEN
      RAISE EXCEPTION 'Stopped: % widget_leads rows were not copied into leads. Nothing was dropped.', v_count;
    END IF;
  END IF;
END
$$;

DROP TABLE IF EXISTS public.ai_training_datasets;
DROP TABLE IF EXISTS public.ai_model_performance;
DROP TABLE IF EXISTS public.automation_metrics;
DROP TABLE IF EXISTS public.widget_leads;
