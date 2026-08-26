/**
 * Single source of truth for Anthropic model ids.
 * Override with ANTHROPIC_MODEL in env (e.g. when Anthropic retires an id).
 * Do not hardcode model strings in call sites — omit `model` so this default applies.
 */
export const DEFAULT_AI_MODEL =
  process.env.ANTHROPIC_MODEL?.trim() || 'claude-haiku-4-5';
