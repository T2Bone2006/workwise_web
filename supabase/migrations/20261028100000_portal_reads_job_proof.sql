-- The customer portal could never show a visit's photos or its full story.
--
-- A portal login (customer_portal_users) can read its own jobs, but job_attachments and
-- job_status_history have no rule for it, so every photo lookup and every "Work started /
-- Completed" step came back empty. Found 2026-10-28 by asking the database as the portal
-- login: the job returned 1 row, its photos 0 and its history 0.
--
-- Rather than open either table, two narrow functions hand back only what the portal
-- shows, and only for jobs of a customer the signed-in login is linked to:
--   portal_job_photos(job_ids)   image files only: id, job, name, url, type
--   portal_job_history(job_id)   id, from, to, when. Not the office notes or metadata.
-- The tables stay closed to portal logins, so nothing else on those rows (office notes,
-- uploader ids, non-image files) can be read. SECURITY DEFINER means the lookup does not
-- go through the tables' own rules, so it cannot loop back through them.
--
-- Safe to paste twice.

CREATE OR REPLACE FUNCTION public.portal_job_photos(p_job_ids uuid[])
RETURNS TABLE (id uuid, job_id uuid, file_name text, file_url text, file_type text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.id, a.job_id, a.file_name, a.file_url, a.file_type
  FROM public.job_attachments a
  JOIN public.jobs j ON j.id = a.job_id
  WHERE a.job_id = ANY (p_job_ids)
    AND lower(coalesce(a.file_type, '')) LIKE 'image/%'
    AND EXISTS (
      SELECT 1 FROM public.customer_portal_users cpu
      WHERE cpu.customer_id = j.customer_id AND cpu.user_id = auth.uid()
    )
  ORDER BY a.created_at;
$$;

CREATE OR REPLACE FUNCTION public.portal_job_history(p_job_id uuid)
RETURNS TABLE (id uuid, from_status text, to_status text, created_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT h.id, h.from_status::text, h.to_status::text, h.created_at
  FROM public.job_status_history h
  JOIN public.jobs j ON j.id = h.job_id
  WHERE h.job_id = p_job_id
    AND EXISTS (
      SELECT 1 FROM public.customer_portal_users cpu
      WHERE cpu.customer_id = j.customer_id AND cpu.user_id = auth.uid()
    )
  ORDER BY h.created_at;
$$;

REVOKE ALL ON FUNCTION public.portal_job_photos(uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.portal_job_history(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_job_photos(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.portal_job_history(uuid) TO authenticated;

COMMENT ON FUNCTION public.portal_job_photos(uuid[]) IS
  'Customer portal: image attachments of jobs belonging to a customer the signed-in login is linked to.';
COMMENT ON FUNCTION public.portal_job_history(uuid) IS
  'Customer portal: status changes (no notes) of one job belonging to a customer the signed-in login is linked to.';
