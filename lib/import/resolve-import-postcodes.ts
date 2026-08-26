'use server';

import { callAIWithLogging } from '@/lib/services/ai-logger';
import { normalizeUkPostcode } from '@/lib/utils/postcode';

/**
 * Resolve unique messy postcode strings via Haiku → normalised UK postcode.
 * Only successes that pass normalizeUkPostcode are returned.
 */
export async function resolveImportPostcodesWithAI(
  rawValues: string[],
  importSourceId?: string | null
): Promise<Record<string, string>> {
  const unique = [
    ...new Set(rawValues.map((v) => v.trim()).filter((v) => v.length > 0)),
  ];
  if (unique.length === 0) return {};

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey?.trim()) {
    console.warn('[resolveImportPostcodesWithAI] No ANTHROPIC_API_KEY');
    return {};
  }

  const prompt = `You extract and normalise UK postcodes from messy spreadsheet cells.

Rules:
- Return a standard UK postcode with a space (e.g. "WS1 3PH", "SW1A 1AA").
- Ignore city names, unit notes, punctuation — keep only the postcode.
- If there is no real UK postcode, omit that input (do not guess).
- Return ONLY a JSON object mapping each input string to the normalised postcode. No markdown.

Input values:
${JSON.stringify(unique)}`;

  try {
    const result = await callAIWithLogging<Record<string, string>>(
      {
        type: 'value_transformation',
        prompt,
        inputData: {
          values: unique,
          job_type: 'import_postcode_parsing',
        },
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
          const normalized = normalizeUkPostcode(val);
          if (normalized) out[key] = normalized;
        }
        return out;
      }
    );
    return result.data ?? {};
  } catch (err) {
    console.error('[resolveImportPostcodesWithAI]', err);
    return {};
  }
}
