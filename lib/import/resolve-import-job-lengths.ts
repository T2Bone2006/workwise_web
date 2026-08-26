'use server';

import { callAIWithLogging } from '@/lib/services/ai-logger';
import { normalizeJobLength } from '@/lib/jobs/normalize-job-length';

export type JobLengthEnum = 'half_day' | 'full_day';

/**
 * Resolve unique messy job-length strings via Haiku → half_day | full_day only.
 */
export async function resolveImportJobLengthsWithAI(
  rawValues: string[],
  importSourceId?: string | null
): Promise<Record<string, JobLengthEnum>> {
  const unique = [
    ...new Set(
      rawValues
        .map((v) => v.trim())
        .filter((v) => v.length > 0 && !normalizeJobLength(v))
    ),
  ];
  if (unique.length === 0) return {};

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey?.trim()) {
    console.warn('[resolveImportJobLengthsWithAI] No ANTHROPIC_API_KEY');
    return {};
  }

  const prompt = `You classify field-job duration strings as half_day or full_day.

Rules:
- Output ONLY "half_day" or "full_day" for each input you can classify.
- Full day ≈ a whole working day / FD / entire day / 9-5 style full shift.
- Half day ≈ half day / HD / morning-only / afternoon-only / short visit block.
- If unclear, omit that input (do not guess).
- Return ONLY a JSON object mapping each input string to "half_day" or "full_day". No markdown.

Input values:
${JSON.stringify(unique)}`;

  try {
    const result = await callAIWithLogging<Record<string, JobLengthEnum>>(
      {
        type: 'value_transformation',
        prompt,
        inputData: {
          values: unique,
          job_type: 'import_job_length_parsing',
        },
        importSourceId: importSourceId ?? undefined,
        max_tokens: 600,
      },
      (response) => {
        let raw = response.trim();
        if (raw.startsWith('```')) {
          raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
        }
        const parsed = JSON.parse(raw) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return {};
        }
        const out: Record<string, JobLengthEnum> = {};
        for (const [key, val] of Object.entries(parsed as Record<string, unknown>)) {
          if (typeof val !== 'string') continue;
          const n = normalizeJobLength(val) ?? normalizeJobLength(val.replace(/_/g, ' '));
          if (n === 'half_day' || n === 'full_day') out[key] = n;
          else if (val.trim().toLowerCase() === 'half_day') out[key] = 'half_day';
          else if (val.trim().toLowerCase() === 'full_day') out[key] = 'full_day';
        }
        return out;
      }
    );
    return result.data ?? {};
  } catch (err) {
    console.error('[resolveImportJobLengthsWithAI]', err);
    return {};
  }
}
