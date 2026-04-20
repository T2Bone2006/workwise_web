/** How well a worker's skills line up with the job's required_skills (for review UI). */
export type WorkerSkillMatchLevel = 'full' | 'partial' | 'none';

export function parseWorkerSkillsArray(skills: unknown): string[] {
  if (Array.isArray(skills)) return skills as string[];
  if (typeof skills === 'string') {
    try {
      const parsed = JSON.parse(skills) as unknown;
      return Array.isArray(parsed) ? (parsed as string[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** Required skills the worker has vs still needs (order follows job.required_skills). */
export function requiredSkillBreakdown(
  requiredSkills: string[],
  workerSkills: string[]
): { matched: string[]; missing: string[] } {
  const ws = new Set(workerSkills);
  const matched: string[] = [];
  const missing: string[] = [];
  for (const r of requiredSkills) {
    if (ws.has(r)) matched.push(r);
    else missing.push(r);
  }
  return { matched, missing };
}

export function skillMatchLevelForJob(
  requiredSkills: string[],
  workerSkills: string[]
): WorkerSkillMatchLevel {
  if (requiredSkills.length === 0) return 'full';
  const ws = new Set(workerSkills);
  let matched = 0;
  for (const r of requiredSkills) {
    if (ws.has(r)) matched++;
  }
  if (matched === requiredSkills.length) return 'full';
  if (matched === 0) return 'none';
  return 'partial';
}

export interface RankedWorkerForJob {
  id: string;
  full_name: string;
  /** Distance from job postcode to worker home; null if job or worker coordinates missing. */
  distanceKm: number | null;
  /** Active jobs in assigned / in_progress / pending_send (same as auto-allocate). */
  currentJobs: number;
  skillMatch: WorkerSkillMatchLevel;
  /** Subset of job required skills this worker has. */
  matchedRequiredSkills: string[];
  /** Required skills this worker lacks. */
  missingRequiredSkills: string[];
}
