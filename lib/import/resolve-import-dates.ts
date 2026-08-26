'use server';

import { callAIWithLogging } from '@/lib/services/ai-logger';
import { parseScheduledDate } from '@/lib/import/parse-scheduled-date';

/**
 * Resolve unique raw date strings that failed deterministic parsing via Haiku.
 * Returns a map of original string → YYYY-MM-DD for successes only.
 */
export async function resolveImportDatesWithAI(
  rawValues: string[],
  importSourceId?: string | null
): Promise<Record<string, string>> {
  const unique = [
    ...new Set(
      rawValues
        .map((v) => v.trim())
        .filter((v) => v.length > 0 && !parseScheduledDate(v))
    ),
  ];
  if (unique.length === 0) return {};

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey?.trim()) {
    console.warn('[resolveImportDatesWithAI] No ANTHROPIC_API_KEY — skipping AI date parse');
    return {};
  }

  const prompt = `You convert spreadsheet date strings to ISO calendar dates (YYYY-MM-DD).

Rules:
- Prefer day-first (UK) when ambiguous (e.g. 01/02/2026 → 2026-02-01).
- Ignore times; use the calendar date only.
- If a value cannot be a real date, omit it from the result (do not guess).
- Return ONLY a JSON object mapping each input string to "YYYY-MM-DD". No markdown.

Input values:
${JSON.stringify(unique)}`;

  try {
    const result = await callAIWithLogging<Record<string, string>>(
      {
        type: 'date_parsing',
        prompt,
        inputData: { values: unique, job_type: 'import_date_parsing' },
        importSourceId: importSourceId ?? undefined,
        max_tokens: 800,
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
        const out: Record<string, string> = {};
        for (const [key, val] of Object.entries(parsed as Record<string, unknown>)) {
          if (typeof val !== 'string') continue;
          const iso =
            parseScheduledDate(val) ??
            (/^\d{4}-\d{2}-\d{2}$/.test(val.trim()) ? val.trim() : null);
          if (iso) out[key] = iso;
        }
        return out;
      }
    );
    return result.data ?? {};
  } catch (err) {
    console.error('[resolveImportDatesWithAI]', err);
    return {};
  }
}
