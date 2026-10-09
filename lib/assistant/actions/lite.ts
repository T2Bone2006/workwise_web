import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { defineAction, type Executed } from '@/lib/assistant/actions/types';
import { asNum, asText, daysAgo, pounds } from '@/lib/assistant/format';
import type { AssistantCard, CardTone } from '@/lib/assistant/shared';
import { defineTool, ok, toolError } from '@/lib/assistant/tools/types';
import { quoteGivenText, setLeadStatus } from '@/lib/lite/leads-core';
import { parseProfile, PriceProfileSchema, type JobType, type PriceProfile } from '@/lib/lite/profile-schema';
import { litePaths } from '@/lib/navigation/lite-paths';
import { todayInLondon } from '@/lib/rounds/dates';
import { LEAD_STATUSES, type LeadStatus } from '@/lib/validations/lite/lead';

const STATUS_LABELS: Record<LeadStatus, string> = { new: 'New', contacted: 'Contacted', won: 'Won', lost: 'Lost' };
const STATUS_TONES: Record<LeadStatus, CardTone> = { new: 'lite', contacted: 'sky', won: 'emerald', lost: 'slate' };

// ---------------------------------------------------------------------------
// Read

export const listLeads = defineTool({
  name: 'list_leads',
  description: 'Website-chat enquiries (Lite leads), newest first: who, the job, the estimate given, status, days waiting.',
  product: 'lite',
  status: 'Looking at your leads',
  schema: z.object({ status: z.enum(LEAD_STATUSES).optional(), show: z.boolean().optional() }),
  async run(ctx, input) {
    let q = ctx.admin
      .from('leads')
      .select('id, name, phone, email, postcode, job_description, job_summary, quote_kind, quote_amount, quote_min, quote_max, status, created_at, follow_up_problem')
      .eq('tenant_id', ctx.tenantId)
      .order('created_at', { ascending: false })
      .limit(40);
    if (input.status) q = q.eq('status', input.status);
    const { data, error } = await q;
    if (error) return toolError('Could not read leads.');
    const rows = (data ?? []) as Record<string, unknown>[];
    const leads = rows.map((r) => {
      const created = typeof r.created_at === 'string' ? todayInLondon(new Date(r.created_at)) : null;
      const status = (LEAD_STATUSES as readonly string[]).includes(String(r.status)) ? (r.status as LeadStatus) : 'new';
      return {
        lead_id: String(r.id),
        name: asText(r.name) ?? 'Someone',
        phone: asText(r.phone),
        email: asText(r.email),
        postcode: asText(r.postcode),
        job: asText(r.job_summary) ?? asText(r.job_description) ?? '',
        estimate: quoteGivenText({ kind: asText(r.quote_kind), amount: asNum(r.quote_amount), min: asNum(r.quote_min), max: asNum(r.quote_max) }) || null,
        status,
        came_in: created,
        days_ago: created ? daysAgo(created, ctx.today) : null,
        ...(asText(r.follow_up_problem) ? { follow_up_problem: asText(r.follow_up_problem) } : {}),
      };
    });
    const cards: AssistantCard[] = [];
    if (input.show && leads.length > 0) {
      cards.push({
        type: 'list',
        title: input.status ? `${STATUS_LABELS[input.status]} leads` : 'Your leads',
        people: true,
        items: leads.slice(0, 15).map((l) => ({
          id: l.lead_id,
          title: l.name,
          subtitle: [l.job, l.came_in ? (l.days_ago === 0 ? 'today' : `${l.days_ago}d ago`) : null].filter(Boolean).join(' · '),
          amount: l.estimate ?? undefined,
          tone: STATUS_TONES[l.status],
          tag: STATUS_LABELS[l.status],
          href: litePaths.lead(l.lead_id),
        })),
        footer: leads.length > 15 ? `${leads.length - 15} more not shown` : undefined,
      });
    }
    return ok({ count: leads.length, leads }, { cards });
  },
});

async function readProfile(admin: SupabaseClient, tenantId: string): Promise<{ profile: PriceProfile; updatedAt: string } | null | 'error' | 'broken'> {
  const { data, error } = await admin.from('lite_price_profiles').select('profile, updated_at').eq('tenant_id', tenantId).maybeSingle();
  if (error) return 'error';
  if (!data) return null;
  const row = data as { profile: unknown; updated_at: unknown };
  const profile = parseProfile(row.profile);
  if (!profile) return 'broken';
  return { profile, updatedAt: String(row.updated_at) };
}

export const getPricing = defineTool({
  name: 'get_pricing',
  description: 'How their website chat prices: areas, rates, kinds of work and ranges, rules, example jobs.',
  product: 'lite',
  status: 'Reading how you price',
  schema: z.object({}),
  async run(ctx) {
    const p = await readProfile(ctx.admin, ctx.tenantId);
    if (p === 'error') return toolError('Could not read their prices.');
    if (p === 'broken') return ok({ note: 'Their saved answers are damaged; they should redo the set-up interview at /lite/setup.' });
    if (!p) return ok({ note: "They haven't finished the set-up interview yet (/lite/setup), so the chat has no prices." });
    return ok(p.profile);
  },
});

// ---------------------------------------------------------------------------
// Act

export const setLeadStatusAction = defineAction({
  name: 'set_lead_status',
  description: 'Propose moving a lead to New, Contacted, Won or Lost.',
  product: 'lite',
  status: 'Getting the lead ready',
  schema: z.object({ lead_id: z.string().uuid(), status: z.enum(LEAD_STATUSES) }),
  async prepare(ctx, input) {
    const { data } = await ctx.admin.from('leads').select('id, name, status, job_summary, job_description').eq('tenant_id', ctx.tenantId).eq('id', input.lead_id).maybeSingle();
    if (!data) return { ok: false, error: 'No lead with that id.' };
    const r = data as Record<string, unknown>;
    if (r.status === input.status) return { ok: false, error: `It's already ${STATUS_LABELS[input.status]}.` };
    const from = (LEAD_STATUSES as readonly string[]).includes(String(r.status)) ? STATUS_LABELS[r.status as LeadStatus] : String(r.status);
    return {
      ok: true,
      params: { leadId: input.lead_id, status: input.status },
      preview: {
        title: `Mark ${asText(r.name) ?? 'this lead'} as ${STATUS_LABELS[input.status]}`,
        lines: [asText(r.job_summary) ?? asText(r.job_description) ?? '', `${from} → ${STATUS_LABELS[input.status]}`].filter(Boolean),
        confirmLabel: `Mark ${STATUS_LABELS[input.status].toLowerCase()}`,
        tone: STATUS_TONES[input.status],
        href: litePaths.lead(input.lead_id),
      },
    };
  },
  async execute(ctx, p: { leadId: string; status: LeadStatus }): Promise<Executed> {
    const r = await setLeadStatus(ctx.admin, { tenantId: ctx.tenantId, leadId: p.leadId, status: p.status });
    if (!r.ok) return { ok: false, error: r.error === 'not_found' ? 'That lead has gone.' : 'Could not save that.' };
    return { ok: true, result: `Marked ${STATUS_LABELS[p.status].toLowerCase()}.`, href: litePaths.lead(p.leadId) };
  },
});

const RATE_LABELS = { callout_fee: 'Callout fee', hourly_rate: 'Hourly rate', day_rate: 'Day rate', minimum_charge: 'Minimum charge' } as const;
const money = z.number().positive().max(50000);

const ChangeSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('set_rate'), rate: z.enum(['callout_fee', 'hourly_rate', 'day_rate', 'minimum_charge']), amount: money.nullable().describe('null removes the rate.') }),
  z.object({
    op: z.literal('set_work'),
    name: z.string().min(2).max(60).describe('Matches existing work by key or name, else adds it.'),
    key: z.string().optional(),
    how_priced: z.enum(['from_description', 'needs_visit']).optional(),
    guide_min: money.nullable().optional(),
    guide_max: money.nullable().optional(),
    what_changes_price: z.string().max(400).optional(),
  }),
  z.object({ op: z.literal('remove_work'), key: z.string() }),
  z.object({ op: z.literal('add_rule'), text: z.string().min(3).max(200) }),
  z.object({ op: z.literal('remove_rule'), text: z.string().min(2) }),
  z.object({
    op: z.literal('set_areas'),
    summary: z.string().max(300).optional(),
    add_postcodes: z.array(z.string().max(8)).max(30).optional(),
    remove_postcodes: z.array(z.string().max(8)).max(30).optional(),
    max_miles: z.number().positive().max(200).nullable().optional(),
  }),
  z.object({ op: z.literal('set_materials'), text: z.string().max(300) }),
]);
type Change = z.infer<typeof ChangeSchema>;

function range(job: Pick<JobType, 'how_priced' | 'guide_min' | 'guide_max'>): string {
  if (job.how_priced === 'needs_visit') return 'needs a visit';
  return `${pounds(job.guide_min)}–${pounds(job.guide_max)}`;
}

function slug(name: string, taken: Set<string>): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 36) || 'work';
  let key = base.length >= 2 ? base : `${base}-x`;
  let n = 2;
  while (taken.has(key)) key = `${base}-${n++}`;
  return key;
}

/** Applies plain-words changes to a copy of the profile. Pure; exported for tests. */
export function applyPricingChanges(profile: PriceProfile, changes: Change[]): { ok: true; profile: PriceProfile; lines: string[] } | { ok: false; error: string } {
  const next: PriceProfile = structuredClone(profile);
  const lines: string[] = [];
  for (const c of changes) {
    if (c.op === 'set_rate') {
      const before = next[c.rate];
      next[c.rate] = c.amount;
      lines.push(`${RATE_LABELS[c.rate]}: ${before == null ? 'none' : pounds(before)} → ${c.amount == null ? 'none' : pounds(c.amount)}`);
    } else if (c.op === 'set_work') {
      const lower = c.name.trim().toLowerCase();
      const job = next.job_types.find((j) => (c.key && j.key === c.key) || j.name.toLowerCase() === lower);
      if (job) {
        const before = range(job);
        if (c.how_priced) job.how_priced = c.how_priced;
        if (c.guide_min !== undefined) job.guide_min = c.guide_min;
        if (c.guide_max !== undefined) job.guide_max = c.guide_max;
        if (c.what_changes_price !== undefined) job.what_changes_price = c.what_changes_price;
        if (job.how_priced === 'needs_visit') job.auto_accept = false;
        const after = range(job);
        lines.push(before === after ? `${job.name}: updated` : `${job.name}: ${before} → ${after}`);
      } else {
        const how = c.how_priced ?? (c.guide_min != null && c.guide_max != null ? 'from_description' : 'needs_visit');
        const added: JobType = {
          key: slug(c.name, new Set(next.job_types.map((j) => j.key))),
          name: c.name.trim(),
          how_priced: how,
          guide_min: c.guide_min ?? null,
          guide_max: c.guide_max ?? null,
          what_changes_price: c.what_changes_price ?? '',
          auto_accept: false,
        };
        next.job_types.push(added);
        lines.push(`New kind of work: ${added.name} (${range(added)})`);
      }
    } else if (c.op === 'remove_work') {
      const job = next.job_types.find((j) => j.key === c.key);
      if (!job) return { ok: false, error: `No kind of work with key "${c.key}".` };
      next.job_types = next.job_types.filter((j) => j.key !== c.key);
      lines.push(`Stop offering: ${job.name}`);
    } else if (c.op === 'add_rule') {
      next.rules.push(c.text.trim());
      lines.push(`New rule: ${c.text.trim()}`);
    } else if (c.op === 'remove_rule') {
      const needle = c.text.trim().toLowerCase();
      const hit = next.rules.find((r) => r.toLowerCase().includes(needle));
      if (!hit) return { ok: false, error: `No rule mentions "${c.text}".` };
      next.rules = next.rules.filter((r) => r !== hit);
      lines.push(`Remove rule: ${hit}`);
    } else if (c.op === 'set_areas') {
      if (c.summary !== undefined) {
        next.areas.summary = c.summary;
        lines.push(`Areas: ${c.summary}`);
      }
      const norm = (pc: string) => pc.toUpperCase().replace(/\s+/g, ' ').trim();
      for (const pc of c.add_postcodes ?? []) {
        if (!next.areas.postcodes.map(norm).includes(norm(pc))) next.areas.postcodes.push(norm(pc));
      }
      if (c.add_postcodes?.length) lines.push(`Add areas: ${c.add_postcodes.map(norm).join(', ')}`);
      if (c.remove_postcodes?.length) {
        const drop = new Set(c.remove_postcodes.map(norm));
        next.areas.postcodes = next.areas.postcodes.filter((pc) => !drop.has(norm(pc)));
        lines.push(`Remove areas: ${[...drop].join(', ')}`);
      }
      if (c.max_miles !== undefined) {
        next.areas.max_miles = c.max_miles;
        lines.push(c.max_miles == null ? 'No mileage limit' : `Up to ${c.max_miles} miles`);
      }
    } else if (c.op === 'set_materials') {
      next.materials = c.text;
      lines.push(`Materials: ${c.text}`);
    }
  }
  const parsed = PriceProfileSchema.safeParse(next);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: `That change doesn't fit: ${issue?.path.join('.') ?? ''} ${issue?.message ?? ''}`.trim() };
  }
  return { ok: true, profile: parsed.data, lines };
}

export const updatePricing = defineAction({
  name: 'update_pricing',
  description: 'Propose changes to how their website chat prices (rates, kinds of work, ranges, rules, areas, materials). Read get_pricing first.',
  product: 'lite',
  status: 'Getting the price changes ready',
  schema: z.object({ changes: z.array(ChangeSchema).min(1).max(15) }),
  async prepare(ctx, input) {
    const current = await readProfile(ctx.admin, ctx.tenantId);
    if (current === 'error') return { ok: false, error: 'Could not read their prices.' };
    if (current === 'broken' || !current) return { ok: false, error: "They need to finish the set-up interview first (/lite/setup)." };
    const applied = applyPricingChanges(current.profile, input.changes);
    if (!applied.ok) return applied;
    return {
      ok: true,
      params: { changes: input.changes },
      preview: {
        title: 'Update how your website chat prices',
        lines: applied.lines,
        confirmLabel: 'Update prices',
        tone: 'lite',
        note: 'Quotes already given stay as they were.',
        href: litePaths.pricing,
      },
    };
  },
  async execute(ctx, p: { changes: Change[] }): Promise<Executed> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const current = await readProfile(ctx.admin, ctx.tenantId);
      if (current === 'error' || current === 'broken' || !current) return { ok: false, error: 'Could not read their prices.' };
      const applied = applyPricingChanges(current.profile, p.changes);
      if (!applied.ok) return applied;
      const { data, error } = await ctx.admin
        .from('lite_price_profiles')
        .update({ profile: applied.profile })
        .eq('tenant_id', ctx.tenantId)
        .eq('updated_at', current.updatedAt)
        .select('tenant_id');
      if (error) return { ok: false, error: 'Could not save that.' };
      if (data && data.length > 0) return { ok: true, result: 'Prices updated; your website chat uses them now.', href: litePaths.pricing };
    }
    return { ok: false, error: 'Your prices were changed somewhere else at the same time. Ask me again.' };
  },
});

export const READ_LITE_TOOLS = [listLeads, getPricing];
export const LITE_ACTIONS = [setLeadStatusAction, updatePricing];

