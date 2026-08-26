'use server';

import { callAIWithLogging } from '@/lib/services/ai-logger';

/** How many jobs to summarise in a single Haiku call. */
const SUMMARY_PROMPT_BATCH = 10;

export type SummaryInput = {
  mappedDescription: string;
  unmappedAppendix: string;
  address?: string;
};

/**
 * Summarise many jobs in few AI calls (true batching — one prompt per chunk of ~10).
 * Returns one string|null per input, same order. Null → caller uses notes fallback (never extras dump).
 */
export async function summarizeJobDescriptionsBatch(
  items: SummaryInput[]
): Promise<(string | null)[]> {
  const out: (string | null)[] = items.map(() => null);
  const needAi: number[] = [];

  for (let i = 0; i < items.length; i++) {
    const mapped = items[i]!.mappedDescription.trim();
    const extras = items[i]!.unmappedAppendix.trim();
    if (extras) {
      needAi.push(i);
    } else if (mapped) {
      out[i] = mapped;
    }
  }

  if (needAi.length === 0) return out;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey?.trim()) {
    console.warn('[summarizeJobDescriptionsBatch] No ANTHROPIC_API_KEY');
    return out;
  }

  for (let start = 0; start < needAi.length; start += SUMMARY_PROMPT_BATCH) {
    const sliceIdx = needAi.slice(start, start + SUMMARY_PROMPT_BATCH);
    const payload = sliceIdx.map((idx) => ({
      id: String(idx),
      address: items[idx]!.address ?? '',
      notes: items[idx]!.mappedDescription.trim() || '(none)',
      extras: items[idx]!.unmappedAppendix.trim() || '(none)',
    }));

    try {
      const result = await callAIWithLogging<Record<string, string>>(
        {
          type: 'description_summary',
          prompt: `You write short job descriptions for field workers.

For each item, write 1–3 clear sentences using notes + extras. Do not invent facts. No bullets. Plain text only.
Do NOT list spreadsheet column names or write "Key: value" dumps — extras are stored separately; distill what the worker needs to know.

Return ONLY a JSON object mapping each item "id" to its summary string. No markdown.

Items:
${JSON.stringify(payload)}`,
          inputData: {
            job_type: 'import_description_summary_batch',
            count: payload.length,
            ids: payload.map((p) => p.id),
          },
          max_tokens: 1200,
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
          const map: Record<string, string> = {};
          for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
            if (typeof v === 'string' && v.trim()) map[k] = v.trim();
          }
          return map;
        }
      );

      for (const idx of sliceIdx) {
        const text = result.data[String(idx)]?.trim();
        if (text) out[idx] = text;
      }
    } catch (err) {
      console.error('[summarizeJobDescriptionsBatch] chunk failed', err);
    }

    if (start + SUMMARY_PROMPT_BATCH < needAi.length) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  return out;
}
