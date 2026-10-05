import { z } from 'zod';
import type { JobType, PriceProfile } from '@/lib/lite/profile-schema';

export const STAGES = ['areas', 'work', 'pricing', 'rules', 'examples', 'website', 'done'] as const;
export type Stage = (typeof STAGES)[number];

export const InterviewTurnSchema = z.object({
  reply: z.string().min(1).max(900),
  stage_complete: z.boolean(),
  patch: z.object({
    areas: z
      .object({
        summary: z.string(),
        postcodes: z.array(z.string()),
        max_miles: z.number().nullable(),
      })
      .nullable(),
    callout_fee: z.number().nullable(),
    hourly_rate: z.number().nullable(),
    day_rate: z.number().nullable(),
    minimum_charge: z.number().nullable(),
    materials: z.string().nullable(),
    job_types: z
      .array(
        z.object({
          key: z.string(),
          name: z.string(),
          how_priced: z.enum(['from_description', 'needs_visit']),
          guide_min: z.number().nullable(),
          guide_max: z.number().nullable(),
          what_changes_price: z.string(),
        }),
      )
      .nullable(),
    rules: z.array(z.string()).nullable(),
    tone: z.string().nullable(),
  }),
});

export type InterviewTurn = z.infer<typeof InterviewTurnSchema>;
export type DraftProfile = Partial<PriceProfile>;

export const ExampleSuggestionsSchema = z.object({
  examples: z
    .array(z.object({ description: z.string().max(300), job_type_key: z.string() }))
    .min(3)
    .max(5),
});

/** One decision for any reply while a single example job is being priced. */
export const ExampleAnswerSchema = z.object({
  outcome: z.enum(['priced', 'need_reason', 'need_detail', 'skip_job', 'skip_rest']),
  reply: z.string().min(1).max(500),
  price: z.number().nullable(),
  reasoning: z.string().nullable(),
  /** True only when this message sets a different total from one already given. */
  replaces_total: z.boolean(),
});

export const ExampleDetailSchema = z.object({
  examples: z.array(z.object({ description: z.string().min(1).max(300) })).min(1).max(5),
});

export const MESSAGE_TOO_LONG = "That's a long message — keep it under 2,000 characters.";

/** Trimmed message must be 1..2000 characters. */
export function interviewMessageError(message: string): string | null {
  const text = message.trim();
  if (text.length < 1) return 'Type a message first.';
  if (text.length > 2000) return MESSAGE_TOO_LONG;
  return null;
}

export const EXAMPLES_INTRO =
  "Okay, that's the profile done. Now let's do some pricing examples. I'll describe a job, and you tell me what you'd charge and why.";

export const WEBSITE_QUESTION =
  "That's the examples done. What's your website address? Something like daveplastering.co.uk — the assistant only works on that site.";

export const MOBILE_QUESTION =
  "What's your mobile, so customers can reach you from that text? Say skip if you'd rather leave it out.";

export function exampleQuestion(description: string, index = 0): string {
  const lead = index === 0 ? 'First one.' : 'Next one.';
  return `${lead} ${description} What would you charge, and why?`;
}

export function signOffQuestion(suggested: string): string {
  return suggested
    ? `What name should texts to customers be signed with? ${suggested} is fine, or type another name.`
    : 'What name should texts to customers be signed with?';
}

export type ExampleReply = { ok: true; price: number; reasoning: string } | { ok: false; need: 'price' | 'why' };

const PRICE_PATTERNS = [/£\s*(\d{1,5}(?:\.\d{1,2})?)/, /(\d{1,5}(?:\.\d{1,2})?)\s*(?:quid|pounds?)/i, /\b(\d{1,5}(?:\.\d{1,2})?)\b/];

/** Pull a price and a short reason out of a chat reply. */
export function parseExampleReply(message: string): ExampleReply {
  const text = message.trim();
  let match: RegExpMatchArray | null = null;
  for (const pattern of PRICE_PATTERNS) {
    match = text.match(pattern);
    if (match) break;
  }
  if (!match || match.index == null) return { ok: false, need: 'price' };
  const price = Number(match[1]);
  if (!Number.isFinite(price) || price <= 0 || price > 50000) return { ok: false, need: 'price' };
  const reasoning = `${text.slice(0, match.index)} ${text.slice(match.index + match[0].length)}`.replace(/\s+/g, ' ').trim();
  if (reasoning.length < 5) return { ok: false, need: 'why' };
  return { ok: true, price, reasoning: reasoning.slice(0, 400) };
}

export function isExampleSkip(message: string): boolean {
  return /^(skip|next|pass)(?:[.!?\s]|$)/i.test(message.trim());
}

export type SetupChat = {
  mode: 'examples' | 'website' | 'signoff' | 'mobile';
  prompts: string[];
  /** -1 while example jobs are still being thought up. */
  cursor: number;
  /** Set on the stored chat once descriptions include what this trade needs. */
  detail_version?: number;
  /** True when detail_version is current. Computed when the chat is read. */
  detailed?: boolean;
  /** Total already given for the current job, waiting on a reason. */
  pending_price?: number;
  website?: string;
  signOff?: string;
};

const CHAT_MODES = ['examples', 'website', 'signoff', 'mobile'] as const;

export function readSetupChat(draft: DraftProfile): SetupChat | null {
  const raw = (draft as { setup_chat?: unknown }).setup_chat;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  if (!CHAT_MODES.includes(row.mode as (typeof CHAT_MODES)[number])) return null;
  const prompts = Array.isArray(row.prompts) ? row.prompts.filter((item): item is string => typeof item === 'string' && item.trim() !== '') : [];
  const cursor = typeof row.cursor === 'number' && Number.isFinite(row.cursor) ? row.cursor : 0;
  const website = typeof row.website === 'string' && row.website.trim() !== '' ? row.website : undefined;
  const signOff = typeof row.signOff === 'string' && row.signOff.trim() !== '' ? row.signOff : undefined;
  const pending =
    typeof row.pending_price === 'number' && row.pending_price > 0 && row.pending_price <= 50000 ? row.pending_price : undefined;
  return {
    mode: row.mode as SetupChat['mode'],
    prompts,
    cursor,
    ...(row.detail_version === 2 ? { detail_version: 2 as const } : {}),
    detailed: row.detail_version === 2,
    ...(pending != null ? { pending_price: pending } : {}),
    website,
    signOff,
  };
}

const CHAT_NEXT: Partial<Record<Stage, Stage>> = {
  areas: 'work',
  work: 'pricing',
  pricing: 'rules',
  rules: 'examples',
};

/** The next chat stage, or null when this stage does not advance on its own. */
export function nextChatStage(stage: Stage): Stage | null {
  return CHAT_NEXT[stage] ?? null;
}

function clip(value: string, max: number): string {
  return value.trim().slice(0, max);
}

function slugify(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

function usableMoney(value: number | null): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 50000) return undefined;
  return value;
}

function usableMiles(value: number | null): number | null {
  if (value == null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 200) return null;
  return value;
}

function cleanAreas(areas: NonNullable<InterviewTurn['patch']['areas']>): NonNullable<DraftProfile['areas']> {
  const postcodes: string[] = [];
  for (const raw of areas.postcodes) {
    const code = clip(raw, 8);
    if (!code) continue;
    postcodes.push(code);
    if (postcodes.length >= 60) break;
  }
  return {
    summary: clip(areas.summary, 300),
    postcodes,
    max_miles: usableMiles(areas.max_miles),
  };
}

function cleanJobs(
  existing: JobType[] | undefined,
  incoming: NonNullable<InterviewTurn['patch']['job_types']>,
): JobType[] {
  const kept = new Map((existing ?? []).map((job) => [job.key, job.auto_accept]));
  const order: string[] = [];
  const byKey = new Map<string, JobType>();
  for (const job of incoming) {
    const key = slugify(job.key) || slugify(job.name);
    if (!/^[a-z0-9-]{2,40}$/.test(key)) continue;
    const name = clip(job.name, 60);
    if (name.length < 2) continue;
    let guideMin = usableMoney(job.guide_min) ?? null;
    let guideMax = usableMoney(job.guide_max) ?? null;
    if (guideMin != null && guideMax != null && guideMin > guideMax) {
      guideMin = null;
      guideMax = null;
    }
    const howPriced = job.how_priced;
    const autoAccept = howPriced === 'from_description' && kept.get(key) === true;
    const next: JobType = {
      key,
      name,
      how_priced: howPriced,
      guide_min: guideMin,
      guide_max: guideMax,
      what_changes_price: clip(job.what_changes_price, 400),
      auto_accept: autoAccept,
    };
    if (!byKey.has(key)) {
      if (order.length >= 30) continue;
      order.push(key);
    }
    byKey.set(key, next);
  }
  return order.flatMap((key) => {
    const job = byKey.get(key);
    return job ? [job] : [];
  });
}

/** Null patch fields leave the draft as it is. A job-type list replaces the whole list. */
export function mergePatch(draft: DraftProfile, patch: InterviewTurn['patch']): DraftProfile {
  const next: DraftProfile = { ...draft };
  if (patch.areas) next.areas = cleanAreas(patch.areas);
  const money: Array<keyof Pick<DraftProfile, 'callout_fee' | 'hourly_rate' | 'day_rate' | 'minimum_charge'>> = [
    'callout_fee',
    'hourly_rate',
    'day_rate',
    'minimum_charge',
  ];
  for (const key of money) {
    const value = usableMoney(patch[key]);
    if (value !== undefined) next[key] = value;
  }
  if (patch.materials != null) next.materials = clip(patch.materials, 300);
  if (patch.job_types) next.job_types = cleanJobs(draft.job_types, patch.job_types);
  if (patch.rules) {
    const rules: string[] = [];
    for (const rule of patch.rules) {
      const text = clip(rule, 200);
      if (!text) continue;
      rules.push(text);
      if (rules.length >= 20) break;
    }
    next.rules = rules;
  }
  if (patch.tone != null) next.tone = clip(patch.tone, 200);
  return next;
}

function validExample(job: { description?: string; price?: number; reasoning?: string } | null | undefined): boolean {
  if (!job) return false;
  const description = job.description?.trim() ?? '';
  const reasoning = job.reasoning?.trim() ?? '';
  const price = job.price;
  return (
    description.length >= 1 &&
    description.length <= 300 &&
    reasoning.length >= 5 &&
    reasoning.length <= 400 &&
    typeof price === 'number' &&
    Number.isFinite(price) &&
    price > 0 &&
    price <= 50000
  );
}

export function stageReady(stage: Stage, draft: DraftProfile): boolean {
  if (stage === 'areas') return (draft.areas?.summary?.trim() ?? '') !== '';
  if (stage === 'work') {
    const jobs = draft.job_types ?? [];
    return jobs.length >= 1 && jobs.every((job) => job.how_priced === 'from_description' || job.how_priced === 'needs_visit');
  }
  if (stage === 'pricing') {
    for (const job of draft.job_types ?? []) {
      if (job.how_priced !== 'from_description') continue;
      if (job.guide_min == null || job.guide_max == null) return false;
      if (job.guide_min > job.guide_max) return false;
    }
    return true;
  }
  if (stage === 'rules') return true;
  if (stage === 'examples') return (draft.example_jobs ?? []).filter((job) => validExample(job)).length >= 3;
  if (stage === 'done') return true;
  return false;
}

/** Plain-English gaps that still stop the profile going live. */
export function missingForFinish(draft: DraftProfile, website: string | null): string[] {
  const missing: string[] = [];
  if ((draft.areas?.summary?.trim() ?? '') === '') missing.push('Say where you work.');
  const jobs = draft.job_types ?? [];
  if (jobs.length < 1) missing.push('Add at least one kind of work.');
  for (const job of jobs) {
    if (job.how_priced !== 'from_description') continue;
    if (job.guide_min == null || job.guide_max == null || job.guide_min > job.guide_max) {
      missing.push(`Add a price range for ${job.name}.`);
    }
  }
  if ((draft.example_jobs ?? []).filter((job) => validExample(job)).length < 3) {
    missing.push('Price at least 3 example jobs.');
  }
  if ((website?.trim() ?? '') === '') missing.push('Add your website.');
  return missing;
}
