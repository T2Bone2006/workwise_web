'use server';

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { DEFAULT_AI_MODEL } from '@/lib/ai/model';
import { logStructuredAiInteraction } from '@/lib/services/ai-interaction-log';
import type { DetectSkillsTenantSkill } from '@/lib/detect-skills';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

export type SkillDetectJob = {
  description: string;
  address?: string;
  priority?: string;
};

const SkillsBatchSchema = z.object({
  jobs: z.array(
    z.object({
      job_index: z.number().int().describe('The 0-based index of the job, copied from the input'),
      skill_keys: z
        .array(z.string())
        .describe('Skill keys required for this job, copied exactly from the available list. [] if none apply.'),
    })
  ),
});

function normaliseTenantSkills(
  skills: DetectSkillsTenantSkill[]
): DetectSkillsTenantSkill[] {
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

/**
 * Detect required skills for many jobs in ONE AI call.
 *
 * The per-job `detectSkills` sends the whole tenant skill list with every job,
 * so a 73-row import made 73 calls and repeated the vocabulary 73 times. Here
 * the list is sent once per batch. Returns one skill array per input job, in
 * order; a job the model omits gets [] rather than another job's skills.
 */
export async function detectSkillsBatch(params: {
  supabase: SupabaseClient;
  tenantId: string;
  jobs: SkillDetectJob[];
  tenantSkills: DetectSkillsTenantSkill[];
  importSourceId?: string | null;
}): Promise<string[][]> {
  const { jobs } = params;
  const empty = jobs.map(() => [] as string[]);
  if (jobs.length === 0) return empty;
  if (!process.env.ANTHROPIC_API_KEY?.trim()) return empty;

  const tenantSkills = normaliseTenantSkills(params.tenantSkills ?? []);
  if (tenantSkills.length === 0) return empty;
  const validSkills = new Set(tenantSkills.map((s) => s.key));

  const skillBullets = tenantSkills.map((s) => `- ${s.key}: ${s.label}`).join('\n');
  const jobLines = jobs
    .map((job, i) => {
      const parts = [`Job ${i}:`, `  description: ${(job.description || '').slice(0, 2000)}`];
      if (job.address?.trim()) parts.push(`  address: ${job.address.trim()}`);
      if (job.priority?.trim()) parts.push(`  priority: ${job.priority.trim()}`);
      return parts.join('\n');
    })
    .join('\n\n');

  const prompt = `Detect the skills required for each job below.

Available skills (use the key before each colon, copied exactly):
${skillBullets}

Jobs:
${jobLines}

Rules:
- Return one entry per job, copying job_index unchanged. Do not skip or reorder jobs.
- Only use keys from the available list. Never invent a key.
- Return [] for a job when no listed skill clearly applies. Do not guess.`;

  const startedAt = Date.now();
  try {
    const response = await anthropic.messages.parse({
      model: DEFAULT_AI_MODEL,
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
      output_config: { format: zodOutputFormat(SkillsBatchSchema) },
    });

    const parsed = response.parsed_output;
    if (!parsed) return empty;

    const byIndex = new Map<number, string[]>();
    for (const entry of parsed.jobs) {
      // Drop anything the model invented — same guard the per-job path had.
      const keys = entry.skill_keys
        .filter((k): k is string => typeof k === 'string')
        .map((k) => k.trim())
        .filter((k) => validSkills.has(k));
      byIndex.set(entry.job_index, [...new Set(keys)]);
    }

    await logStructuredAiInteraction(params.supabase, {
      tenantId: params.tenantId,
      interactionType: 'skill_detection',
      prompt,
      inputData: {
        job_count: jobs.length,
        job_type: 'skill_detection_batch',
        tenant_skill_keys: tenantSkills.map((s) => s.key),
      },
      parsedOutput: parsed,
      model: DEFAULT_AI_MODEL,
      tokensInput: response.usage.input_tokens,
      tokensOutput: response.usage.output_tokens,
      latencyMs: Date.now() - startedAt,
      importSourceId: params.importSourceId,
    });

    return jobs.map((_, i) => byIndex.get(i) ?? []);
  } catch (err) {
    console.error('[detectSkillsBatch]', err);
    return empty;
  }
}
