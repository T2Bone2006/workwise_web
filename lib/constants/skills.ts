export const SKILL_LABELS: Record<string, string> = {
  residential_locks: 'Residential Locks',
  commercial_locks: 'Commercial Locks',
  safe_installation: 'Safe Installation',
  high_security_locks: 'High Security Locks',
  emergency_callout: 'Emergency Callout',
  lock_fitting: 'Lock Fitting',
  key_cutting: 'Key Cutting',
  master_key_systems: 'Master Key Systems',
  automotive_locks: 'Automotive Locks',
  access_control: 'Access Control',
};

export const SKILL_KEYS = [
  'residential_locks',
  'commercial_locks',
  'safe_installation',
  'high_security_locks',
  'emergency_callout',
  'lock_fitting',
  'key_cutting',
  'master_key_systems',
  'automotive_locks',
  'access_control',
] as const;

export type SkillKey = (typeof SKILL_KEYS)[number];
