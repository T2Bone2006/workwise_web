/**
 * AI-powered skill detection for locksmith jobs.
 * Uses centralized AI logger for all interactions (training data).
 */

import { callAIWithLogging, type AICallResult } from './services/ai-logger';

const VALID_SKILLS = new Set([
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
]);

export type DetectSkillsInput = {
  description: string;
  address?: string;
  priority?: string;
};

const SKILLS_PROMPT = `Analyze this locksmith job and detect required skills.

Job description: "{{description}}"
Address: {{address}}
Priority: {{priority}}

Available skills:
- residential_locks: Standard home locks
- commercial_locks: Business/office locks
- safe_installation: Safes and vaults
- high_security_locks: Advanced security systems
- emergency_callout: Urgent/out-of-hours work
- lock_fitting: New lock installation
- key_cutting: Key duplication/creation
- master_key_systems: Complex key systems
- automotive_locks: Car/vehicle locks
- access_control: Electronic access systems

Return ONLY a JSON array of required skills. Examples:
- "Emergency safe won't open at office" → ["safe_installation", "commercial_locks", "emergency_callout"]
- "New locks for house" → ["residential_locks", "lock_fitting"]

Return empty array [] if no specific skills required.`;

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

  const description = (input.description || '').slice(0, 2000);
  const address = input.address ?? '';
  const priority = input.priority ?? 'normal';

  const prompt = SKILLS_PROMPT.replace('{{description}}', description)
    .replace('{{address}}', address)
    .replace('{{priority}}', priority);

  try {
    const result = await callAIWithLogging(
      {
        type: 'skill_detection',
        prompt,
        inputData: {
          description,
          address,
          priority,
          job_type: 'locksmith',
        },
        jobId,
      },
      (response) => {
        const cleaned = response.replace(/```json|```/g, '').trim();
        const parsed = JSON.parse(cleaned) as unknown;
        if (!Array.isArray(parsed)) return [];
        const skills = parsed
          .filter((s): s is string => typeof s === 'string')
          .filter((s) => VALID_SKILLS.has(s));
        return [...new Set(skills)];
      }
    );
    return result;
  } catch (err) {
    console.error('[detectSkills]', err);
    return { data: [], interactionId: '', cost: 0, latency: 0 };
  }
}
