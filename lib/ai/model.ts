/**
 * Single source of truth for Anthropic model ids.
 * Override with ANTHROPIC_MODEL in env (e.g. when Anthropic retires an id).
 * Do not hardcode model strings in call sites — omit `model` so this default applies.
 */
export const DEFAULT_AI_MODEL =
  process.env.ANTHROPIC_MODEL?.trim() || 'claude-haiku-4-5';

/**
 * Import row extraction reads a whole spreadsheet row into a job.
 *
 * Measured on real messy sheets, Haiku matched both Sonnet and Opus on every
 * hard case — fused date+time cells, postcode buried in the address, priority
 * implied by wording ("URGENT"), "16 Sept 2026", "2.30pm", half-day wording,
 * and correctly returning empty rather than inventing a missing address — at
 * roughly a third of Sonnet's cost. Raise to 'claude-sonnet-5' or
 * 'claude-opus-5' via ANTHROPIC_EXTRACTION_MODEL if a future sheet defeats it.
 */
export const EXTRACTION_AI_MODEL =
  process.env.ANTHROPIC_EXTRACTION_MODEL?.trim() || 'claude-haiku-4-5';

/**
 * `output_config.effort` is rejected with a 400 on older models (Haiku 4.5
 * among them), so it can only be sent when the configured model supports it.
 */
export function supportsEffort(model: string): boolean {
  return /^claude-(opus-(5|4-[5-9])|sonnet-5|fable-5|mythos-5)/.test(model);
}

/** Per-million-token USD rates for cost logging. Falls back to Sonnet rates. */
const MODEL_RATES: Record<string, { input: number; output: number }> = {
  'claude-opus-5': { input: 5, output: 25 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-haiku-4-5': { input: 1, output: 5 },
};

export function estimateAiCostUsd(
  model: string,
  tokensInput: number,
  tokensOutput: number
): number {
  const rate = MODEL_RATES[model] ?? { input: 3, output: 15 };
  return (tokensInput / 1_000_000) * rate.input + (tokensOutput / 1_000_000) * rate.output;
}
