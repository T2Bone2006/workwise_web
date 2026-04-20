-- Job lifecycle: assigned to worker but not yet notified (dashboard "send out" step)
DO $$
BEGIN
  ALTER TYPE job_status ADD VALUE 'pending_send';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

ALTER TABLE workers ADD COLUMN IF NOT EXISTS expo_push_token text;

COMMENT ON COLUMN workers.expo_push_token IS 'Expo push token for mobile app notifications (ExponentPushToken[...])';
