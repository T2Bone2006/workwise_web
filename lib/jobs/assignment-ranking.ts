/**
 * Shared ranking rules for choosing a worker (or connected business) for a job.
 *
 * Distance is compared in bands rather than exactly. Haversine distances are
 * floats, so two candidates are essentially never bit-for-bit equal — comparing
 * them directly meant the workload tiebreaker never ran, and the nearest
 * candidate won regardless of how many jobs they already had.
 */

/**
 * How much extra travel one already-assigned job is "worth" avoiding.
 * Each open job on a candidate adds this many km to their effective distance,
 * so a much busier candidate loses to a slightly further, freer one — while a
 * genuinely distant candidate still loses on distance alone.
 *
 * Deliberately a weighted score rather than distance bands: bands put 2.1km
 * and 2.3km either side of a boundary, so the overloaded-but-nearer candidate
 * still won, and a "treat as equal if within X" comparator is not transitive
 * (undefined sort behaviour).
 */
export const LOAD_PENALTY_KM = 0.75;

/** Effective distance: real distance plus a penalty for existing workload. */
export function assignmentScore(distanceKm: number | null, load: number): number {
  const distance = distanceKm ?? Infinity;
  if (!Number.isFinite(distance)) return Number.POSITIVE_INFINITY;
  return distance + Math.max(0, load) * LOAD_PENALTY_KM;
}

/** Lower score wins. Ties fall back to raw distance for stable ordering. */
export function compareByDistanceThenLoad(
  a: { distanceKm: number | null; load: number },
  b: { distanceKm: number | null; load: number }
): number {
  const sa = assignmentScore(a.distanceKm, a.load);
  const sb = assignmentScore(b.distanceKm, b.load);
  if (sa !== sb) return sa - sb;
  return (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity);
}

/** Postcode-based grouping key: same postcode is treated as the same site. */
export function clusterKeyForPostcode(postcode: string | null | undefined): string | null {
  const normalized = postcode?.replace(/\s+/g, '').toUpperCase().trim();
  return normalized && normalized.length > 0 ? normalized : null;
}

/** Union of required skills across a group, so one assignee can cover them all. */
export function unionRequiredSkills(jobs: Array<{ required_skills?: unknown }>): string[] {
  const out = new Set<string>();
  for (const job of jobs) {
    const skills = Array.isArray(job.required_skills) ? job.required_skills : [];
    for (const skill of skills) {
      if (typeof skill === 'string' && skill.trim()) out.add(skill.trim());
    }
  }
  return [...out];
}

/** Stable signature of a job's skills, for splitting a group that can't be covered as one. */
export function skillSignature(required: unknown): string {
  const skills = Array.isArray(required) ? required : [];
  return skills
    .filter((s): s is string => typeof s === 'string')
    .map((s) => s.trim())
    .sort()
    .join('|');
}
