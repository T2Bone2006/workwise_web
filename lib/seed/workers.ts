/**
 * Generate seed worker records for dev/testing.
 * Seed workers use email @seed.workwise.local so they can be wiped before production.
 */

import { SKILL_LABELS } from '@/lib/constants/skills';
import { getRandomPostcode } from '@/lib/seed/uk-postcodes';
import { randomSeedName } from '@/lib/seed/worker-names';

const SKILL_KEYS = Object.keys(SKILL_LABELS) as string[];

export const SEED_EMAIL_DOMAIN = '@seed.workwise.local';

export interface SeedWorkerInput {
  tenantId: string;
  index: number;
}

export interface SeedWorkerRecord {
  full_name: string;
  phone: string;
  email: string;
  primary_tenant_id: string;
  home_postcode: string;
  home_lat: number;
  home_lng: number;
  service_radius_km: number;
  skills: string[];
  status: string;
}

/**
 * Pick 0 to maxSkills random skills (varied so some workers have few, some many).
 */
function randomSkills(maxSkills: number): string[] {
  const count = Math.floor(Math.random() * (maxSkills + 1));
  const shuffled = [...SKILL_KEYS].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

/**
 * Generate one seed worker for the given tenant and index.
 */
export function generateSeedWorker({ tenantId, index }: SeedWorkerInput): SeedWorkerRecord {
  const location = getRandomPostcode();
  const numSkills = Math.random() < 0.2 ? 0 : Math.min(1 + Math.floor(Math.random() * 5), SKILL_KEYS.length);
  const skills = numSkills === 0 ? [] : randomSkills(numSkills);

  return {
    full_name: randomSeedName(),
    phone: `07${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`,
    email: `seed-${index}-${Date.now().toString(36)}${SEED_EMAIL_DOMAIN}`,
    primary_tenant_id: tenantId,
    home_postcode: location.postcode,
    home_lat: location.lat,
    home_lng: location.lng,
    service_radius_km: 30 + Math.floor(Math.random() * 40),
    skills,
    status: 'available',
  };
}

/**
 * Generate N seed workers for a tenant.
 */
export function generateSeedWorkers(tenantId: string, count: number): SeedWorkerRecord[] {
  const workers: SeedWorkerRecord[] = [];
  for (let i = 0; i < count; i++) {
    workers.push(generateSeedWorker({ tenantId, index: i + 1 }));
  }
  return workers;
}
