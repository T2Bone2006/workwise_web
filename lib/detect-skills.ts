/**
 * AI-powered skill detection from job text.
 * Uses centralized AI logger for all interactions (training data).
 */

import { callAIWithLogging, type AICallResult } from './services/ai-logger';

export type DetectSkillsTenantSkill = { key: string; label: string };

export type DetectSkillsInput = {
  description: string;
  address?: string;
  priority?: string;
  tenantSkills: DetectSkillsTenantSkill[];
};

/** Template: {{skills_bullets}} injected from tenantSkills. */
const SKILLS_PROMPT_TEMPLATE = `Analyze this job and detect required skills from the description.

Job description: "{{description}}"
Address: {{address}}
Priority: {{priority}}

Available skills:
{{skills_bullets}}

Return ONLY a JSON array of required skill keys. Each key MUST be copied exactly from the list above (the part before each colon).

Example: If the description clearly needs skills from the list, return something like ["one_key_here", "another_key"] using only keys that appear above.

Return empty array [] if no skills from the list apply, or if no skills are configured.`;

function normaliseTenantSkills(skills: DetectSkillsTenantSkill[]): DetectSkillsTenantSkill[] {
  const seen = new Set<string>();
  const out: DetectSkillsTenantSkill[] = [];
  for (const raw of skills) {
    const key = typeof raw.key === 'string' ? raw.key.trim() : '';
    const label = typeof raw.label === 'string' ? raw.label.trim() : '';
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ key, label: label || key });
  }
  return out;
}

function buildSkillsBullets(skills: DetectSkillsTenantSkill[]): string {
  if (skills.length === 0) {
    return '(No skills are configured — return []).';
  }
  return skills.map((s) => `- ${s.key}: ${s.label}`).join('\n');
}

/**
 * Detect required skills from job description using Claude.
 * Returns result with data (array of skill keys), interactionId, cost, latency.
 * On API/key errors returns { data: [], interactionId: '', cost: 0, latency: 0 } so callers can continue.
 */
export async function detectSkills(
  input: DetectSkillsInput,
  jobId?: string
): Promise<AICallResult<string[]>> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey?.trim()) {
    return { data: [], interactionId: '', cost: 0, latency: 0 };
  }

  const tenantSkills = normaliseTenantSkills(input.tenantSkills ?? []);
  if (tenantSkills.length === 0) {
    return { data: [], interactionId: '', cost: 0, latency: 0 };
  }

  const validSkills = new Set(tenantSkills.map((s) => s.key));

  const description = (input.description || '').slice(0, 2000);
  const address = input.address ?? '';
  const priority = input.priority ?? 'normal';

  const bullets = buildSkillsBullets(tenantSkills);
  const prompt = SKILLS_PROMPT_TEMPLATE.replace('{{description}}', description)
    .replace('{{address}}', address)
    .replace('{{priority}}', priority)
    .replace('{{skills_bullets}}', bullets);

  try {
    const result = await callAIWithLogging(
      {
        type: 'skill_detection',
        prompt,
        inputData: {
          description,
          address,
          priority,
          job_type: 'skill_detection',
          tenant_skill_keys: tenantSkills.map((s) => s.key),
        },
        jobId,
      },
      (response) => {
        const cleaned = response.replace(/```json|```/g, '').trim();
        const parsed = JSON.parse(cleaned) as unknown;
        if (!Array.isArray(parsed)) return [];
        const skills = parsed
          .filter((s): s is string => typeof s === 'string')
          .filter((s) => validSkills.has(s.trim()))
          .map((s) => s.trim());
        return [...new Set(skills)];
      }
    );
    return result;
  } catch (err) {
    console.error('[detectSkills]', err);
    return { data: [], interactionId: '', cost: 0, latency: 0 };
  }
}
