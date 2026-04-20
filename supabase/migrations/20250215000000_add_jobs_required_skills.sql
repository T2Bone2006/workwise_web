-- Add required_skills to jobs (AI-detected skills for auto-assignment)
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS required_skills JSONB DEFAULT '[]'::jsonb;
CREATE INDEX IF NOT EXISTS idx_jobs_required_skills ON jobs USING gin(required_skills);

-- Ensure workers.skills is indexed for contains queries
CREATE INDEX IF NOT EXISTS idx_workers_skills ON workers USING gin(skills);
