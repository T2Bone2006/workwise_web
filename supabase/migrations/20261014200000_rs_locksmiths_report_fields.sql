-- Debbie (RS Locksmiths) finish-job form.
--
-- After "Customer in?": shutter engineer (and how the shutter was dealt
-- with), access control engineer, and carpentry. The lock and walk-away
-- questions stay as they are. Other settings on the business are left
-- alone. Eden is not this name, so it is not touched.
--
-- Paste into the Supabase SQL editor. Stops if the name is missing or
-- matches more than one business. Safe to re-run: it writes this same list.

DO $$
DECLARE
  v_name constant text := 'RS Locksmiths';
  v_n int;
  v_id uuid;
BEGIN
  SELECT count(*) INTO v_n FROM public.tenants WHERE name = v_name;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one tenant named %, found %', v_name, v_n;
  END IF;

  SELECT id INTO v_id FROM public.tenants WHERE name = v_name;

  UPDATE public.tenants
  SET settings = jsonb_set(
    COALESCE(settings, '{}'::jsonb),
    '{job_report_fields}',
    $fields$[
      {
        "id": "customer_in",
        "type": "yes_no",
        "required": true,
        "label": "Customer in?"
      },
      {
        "id": "shutter_engineer",
        "type": "yes_no",
        "required": true,
        "label": "Shutter engineer?"
      },
      {
        "id": "shutter_action",
        "type": "select",
        "required": true,
        "label": "How was the shutter dealt with?",
        "options": [
          "Manually overrode",
          "Keyswitch on side",
          "Electrically overrode",
          "No action",
          "Other"
        ],
        "show_when": { "field": "shutter_engineer", "value": true }
      },
      {
        "id": "shutter_action_other",
        "type": "text",
        "required": true,
        "label": "What happened?",
        "show_when": { "field": "shutter_action", "value": "Other" }
      },
      {
        "id": "access_control_engineer",
        "type": "yes_no",
        "required": true,
        "label": "Access control engineer?"
      },
      {
        "id": "carpentry",
        "type": "yes_no",
        "required": true,
        "label": "Carpentry?"
      },
      {
        "id": "lock_opened",
        "type": "yes_no",
        "required": true,
        "label": "Did you pick, slip, or drill the lock?"
      },
      {
        "id": "lock_open_method",
        "type": "select",
        "required": true,
        "label": "How was the lock opened?",
        "options": ["Pick", "Slip", "Drill", "Other"],
        "show_when": { "field": "lock_opened", "value": true }
      },
      {
        "id": "lock_open_method_other",
        "type": "text",
        "required": true,
        "label": "How else was the lock opened?",
        "show_when": { "field": "lock_open_method", "value": "Other" }
      },
      {
        "id": "lock_changed",
        "type": "yes_no",
        "required": true,
        "label": "Was the lock changed?"
      },
      {
        "id": "lock_type",
        "type": "select",
        "required": true,
        "label": "Lock type",
        "options": ["Yale", "Mortice", "Euro Cylinder", "Rim Lock", "Padlock", "Other"],
        "show_when": { "field": "lock_changed", "value": true }
      },
      {
        "id": "lock_type_other",
        "type": "text",
        "required": true,
        "label": "Type of lock",
        "show_when": { "field": "lock_type", "value": "Other" }
      },
      {
        "id": "walk_away",
        "type": "yes_no",
        "required": true,
        "label": "Did you walk away?",
        "blocks_completion": true
      },
      {
        "id": "walk_away_detail",
        "type": "text",
        "required": true,
        "label": "Reason for walkaway",
        "multiline": true,
        "show_when": { "field": "walk_away", "value": true }
      }
    ]$fields$::jsonb,
    true
  )
  WHERE id = v_id;
END $$;
