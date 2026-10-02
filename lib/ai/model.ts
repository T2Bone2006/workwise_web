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
 * roughly a third of Sonnet's cost. Raise to 'claude-sonnet-5-5' or
 * 'claude-opus-5' via ANTHROPIC_EXTRACTION_MODEL if a future sheet defeats it.
 */
export const EXTRACTION_AI_MODEL =
  process.env.ANTHROPIC_EXTRACTION_MODEL?.trim() || 'claude-haiku-4-5';

/**
 * Import grouping suggestion: one call per new import source, reading the
 * headers plus a sample of rows and naming the columns that identify a set of
 * jobs one worker should do together. Haiku, Sonnet and Opus all picked the
 * same four columns on the real MPAAS sheet (twice each), and the answer is
 * validated against the rows before it is used, so the cheapest model is
 * fine. Raise via ANTHROPIC_GROUPING_MODEL if a sheet defeats it.
 */
export const GROUPING_AI_MODEL =
  process.env.ANTHROPIC_GROUPING_MODEL?.trim() || 'claude-haiku-4-5';

/**
 * Phase 5 receipt reading. Owner decision (2026-10-02, before any real-receipt
 * test): Sonnet reads every receipt. It costs about 1p a receipt against 0.3p on
 * Haiku, and a confidently-wrong total is the error the "unsure" re-read cannot
 * catch and that ends up in the accountant's numbers. When the escalation model
 * is the same as the first (the default now) there is no second read; set
 * RECEIPT_AI_MODEL=claude-haiku-4-5 to go back to "Haiku first, Sonnet when
 * unsure" (see `needsEscalation`).
 */
export const RECEIPT_AI_MODEL = process.env.RECEIPT_AI_MODEL?.trim() || 'claude-sonnet-5-5';
export const RECEIPT_ESCALATION_MODEL =
  process.env.RECEIPT_ESCALATION_MODEL?.trim() || 'claude-sonnet-5-5';

/**
 * Phase 5 round-book reading (T14): photos of a handwritten round book or a
 * typed list. Sonnet, not Haiku, because handwriting defeats Haiku more often.
 */
export const ROUND_BOOK_AI_MODEL = process.env.ROUND_BOOK_AI_MODEL?.trim() || 'claude-sonnet-5-5';

/**
 * Rounds customer import (spreadsheets). Haiku for now, same as Pro's job import
 * (text rows, not photos; it read a deliberately messy 28-row sheet well). Its
 * own setting so it can be raised to 'claude-sonnet-5-5' without touching Pro.
 */
export const CUSTOMER_IMPORT_AI_MODEL =
  process.env.CUSTOMER_IMPORT_AI_MODEL?.trim() || 'claude-haiku-4-5';

/**
 * `output_config.effort` is rejected with a 400 on older models (Haiku 4.5
 * among them), so it can only be sent when the configured model supports it.
 */
export function supportsEffort(model: string): boolean {
  return /^claude-(opus-(5|4-[5-9])|sonnet-5|fable-5|mythos-5)/.test(model);
}

/** Per-million-token USD rates for cost logging. Falls back to Sonnet rates. */
const MODEL_RATES: Record<string, { input: number; output: number }> = {
  'claude-opus-5-5': { input: 4, output: 20 },
  'claude-opus-5': { input: 5, output: 25 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
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
