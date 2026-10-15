import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PriceProfile } from '@/lib/lite/profile-schema';
import { PriceProfileSchema } from '@/lib/lite/profile-schema';
import type { LiteContext } from '@/lib/lite/require-lite';
import type { DraftProfile } from '@/lib/lite/interview-schema';

const parse = vi.fn();
const logStructuredAiInteraction = vi.fn();

vi.mock('@anthropic-ai/sdk', () => ({
  default: class Anthropic {
    constructor(opts: unknown) {
      void opts;
    }
    messages = { parse };
  },
}));

vi.mock('@/lib/services/ai-interaction-log', () => ({
  logStructuredAiInteraction: (...args: unknown[]) => logStructuredAiInteraction(...args),
}));

import { beginExampleChat, fillExampleDetail, finishInterview, getOrStartInterview, interviewTurn, saveExampleJobs, saveWebsiteStep } from '@/lib/lite/interview';

type Rec = Record<string, unknown>;

const state = {
  interviews: [] as Rec[],
  profiles: [] as Rec[],
  widgets: [] as Rec[],
  users: [] as Rec[],
  blindOpenReads: 0,
  failNextClaim: false,
  upsertError: false,
  finishMiss: false,
};

function matched(rows: Rec[], filters: Array<(row: Rec) => boolean>) {
  return rows.filter((row) => filters.every((pred) => pred(row)));
}

function builder(table: string, rows: Rec[]) {
  const filters: Array<(row: Rec) => boolean> = [];
  const eqs: Array<[string, unknown]> = [];
  let mode: 'select' | 'update' | 'insert' | 'upsert' = 'select';
  let patch: Rec | null = null;
  let incoming: Rec | null = null;

  function execute(single: boolean): { data: unknown; error: { code?: string; message: string } | null } {
    if (mode === 'insert') {
      const row = incoming ?? {};
      const clash =
        table === 'lite_interviews' &&
        row.status === 'in_progress' &&
        rows.some((existing) => existing.tenant_id === row.tenant_id && existing.status === 'in_progress');
      if (clash) return { data: null, error: { code: '23505', message: 'duplicate' } };
      const stored = {
        id: `interview-${rows.length + 1}`,
        example_jobs: [],
        messages: [],
        draft_profile: {},
        turn_count: 0,
        status: 'in_progress',
        stage: 'areas',
        ...row,
      };
      rows.push(stored);
      return { data: single ? stored : [stored], error: null };
    }
    if (mode === 'upsert') {
      if (state.upsertError) return { data: null, error: { message: 'boom' } };
      const row = incoming ?? {};
      const index = rows.findIndex((existing) => existing.tenant_id === row.tenant_id);
      if (index >= 0) rows[index] = { ...rows[index], ...row };
      else rows.push({ ...row });
      return { data: null, error: null };
    }
    if (mode === 'update') {
      if (state.failNextClaim && patch && 'turn_count' in patch && 'messages' in patch) {
        state.failNextClaim = false;
        return { data: [], error: null };
      }
      if (state.finishMiss && patch?.status === 'finished') {
        state.finishMiss = false;
        return { data: [], error: null };
      }
      const hit = matched(rows, filters);
      for (const row of hit) Object.assign(row, patch);
      return { data: hit.map((row) => ({ id: row.id })), error: null };
    }
    const openRead = eqs.some(([key, value]) => key === 'status' && value === 'in_progress') && !eqs.some(([key]) => key === 'id');
    if (single && table === 'lite_interviews' && openRead && state.blindOpenReads > 0) {
      state.blindOpenReads -= 1;
      return { data: null, error: null };
    }
    const hit = matched(rows, filters);
    return { data: single ? (hit[0] ?? null) : hit, error: null };
  }

  const api = {
    select: () => api,
    eq: (key: string, value: unknown) => {
      eqs.push([key, value]);
      filters.push((row) => row[key] === value);
      return api;
    },
    insert: (row: Rec) => {
      mode = 'insert';
      incoming = row;
      return api;
    },
    update: (next: Rec) => {
      mode = 'update';
      patch = next;
      return api;
    },
    upsert: (row: Rec) => {
      mode = 'upsert';
      incoming = row;
      return api;
    },
    maybeSingle: async () => execute(true),
    then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(execute(false)).then(resolve, reject),
  };
  return api;
}

const admin = {
  from(table: string) {
    if (table === 'lite_interviews') return builder(table, state.interviews);
    if (table === 'lite_price_profiles') return builder(table, state.profiles);
    if (table === 'widget_clients') return builder(table, state.widgets);
    if (table === 'users') return builder(table, state.users);
    throw new Error(table);
  },
} as unknown as SupabaseClient;

const ctx: LiteContext = {
  tenantId: 'tenant-1',
  userId: 'user-1',
  widget: {
    id: 'widget-1',
    business_name: "Dave's Plastering",
    sign_off_name: null,
    trade: 'plastering',
    service_area: 'South Manchester',
    business_context: '',
  },
};

function job(overrides: Record<string, unknown> = {}) {
  return {
    key: 'skim',
    name: 'Skim',
    how_priced: 'from_description' as const,
    guide_min: 80,
    guide_max: 150,
    what_changes_price: 'Room size',
    auto_accept: false,
    ...overrides,
  };
}

function examples(count = 3) {
  return Array.from({ length: count }, (_, index) => ({
    description: `Example ${index + 1} in a small bedroom`,
    price: 90 + index,
    reasoning: 'A normal ceiling skim',
  }));
}

const liveProfile: PriceProfile = {
  areas: { summary: 'South Manchester', postcodes: ['M14'], max_miles: 12 },
  callout_fee: 40,
  hourly_rate: null,
  day_rate: null,
  minimum_charge: 60,
  materials: 'Customer buys the plaster',
  job_types: [job({ key: 'lock-change', name: 'Lock change', auto_accept: true })],
  rules: ['No Sundays'],
  example_jobs: examples(),
  tone: 'Warm',
};

function emptyPatch(overrides: Record<string, unknown> = {}) {
  return {
    areas: null,
    callout_fee: null,
    hourly_rate: null,
    day_rate: null,
    minimum_charge: null,
    materials: null,
    job_types: null,
    rules: null,
    tone: null,
    ...overrides,
  };
}

function turn(overrides: Record<string, unknown> = {}) {
  return {
    stop_reason: 'end_turn',
    parsed_output: {
      reply: 'What sort of plastering do you do?',
      stage_complete: false,
      patch: emptyPatch(),
    },
    usage: { input_tokens: 11, output_tokens: 7 },
    ...overrides,
  };
}

function reset() {
  state.interviews.length = 0;
  state.profiles.length = 0;
  state.widgets.length = 0;
  state.users.length = 0;
  state.blindOpenReads = 0;
  state.failNextClaim = false;
  state.upsertError = false;
  state.finishMiss = false;
  state.users.push({ id: 'user-1', full_name: 'Dave Smith' });
  state.widgets.push({
    id: 'widget-1',
    tenant_id: 'tenant-1',
    allowed_domains: [],
    website_url: null,
    sign_off_name: null,
    owner_mobile_e164: null,
  });
  parse.mockReset();
  logStructuredAiInteraction.mockReset();
  logStructuredAiInteraction.mockResolvedValue(undefined);
  parse.mockResolvedValue(turn());
}

describe('getOrStartInterview', () => {
  beforeEach(reset);

  it('starts one interview, and a second tab gets that same one', async () => {
    const first = await getOrStartInterview(admin, ctx);
    const second = await getOrStartInterview(admin, ctx);
    expect(first.id).toBe(second.id);
    expect(state.interviews).toHaveLength(1);
    expect(first.messages[0]?.content).toContain('Hi Dave!');
    expect(first.messages[0]?.content).toContain('10–15 minutes');
    expect(first.stage).toBe('areas');
  });

  it('reloads the open interview when the insert hits the one-open index', async () => {
    state.interviews.push({
      id: 'already-open',
      tenant_id: 'tenant-1',
      status: 'in_progress',
      stage: 'work',
      messages: [{ role: 'assistant', content: 'Existing' }],
      draft_profile: {},
      example_jobs: [],
      turn_count: 2,
    });
    state.blindOpenReads = 1;
    const view = await getOrStartInterview(admin, ctx);
    expect(view.id).toBe('already-open');
    expect(state.interviews).toHaveLength(1);
  });

  it('copies the live profile into a redo and leaves the live profile untouched', async () => {
    state.profiles.push({ tenant_id: 'tenant-1', profile: liveProfile, version: 3 });
    const before = JSON.parse(JSON.stringify(state.profiles[0]));
    const view = await getOrStartInterview(admin, ctx, { redo: true });
    expect(view.draft.job_types?.[0]).toMatchObject({ key: 'lock-change', auto_accept: true });
    expect(view.examples).toHaveLength(3);
    expect(view.draft.callout_fee).toBe(40);
    expect(state.profiles[0]).toEqual(before);
    const again = await getOrStartInterview(admin, ctx, { redo: true });
    expect(again.id).toBe(view.id);
    expect(state.interviews).toHaveLength(1);
    expect(state.profiles[0]).toEqual(before);
  });
});

describe('interviewTurn', () => {
  beforeEach(reset);

  async function started() {
    return getOrStartInterview(admin, ctx);
  }

  it('advances one stage when the answer is complete, and does not skip ahead', async () => {
    const view = await started();
    parse.mockResolvedValue(
      turn({
        parsed_output: {
          reply: 'What kinds of plastering do you want enquiries for?',
          stage_complete: true,
          patch: emptyPatch({
            areas: { summary: 'South Manchester', postcodes: ['M14'], max_miles: 12 },
            job_types: [
              {
                key: 'skim',
                name: 'Skim',
                how_priced: 'from_description',
                guide_min: 80,
                guide_max: 150,
                what_changes_price: 'Room size',
              },
            ],
          }),
        },
      }),
    );
    const result = await interviewTurn(admin, ctx, { interviewId: view.id, message: 'South Manchester, about 12 miles. MARKER-SECRET' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.view.stage).toBe('work');
    expect(result.view.draft.areas?.summary).toBe('South Manchester');
    expect(result.view.messages.at(-1)?.content).toContain('plastering');
    const body = parse.mock.calls.at(-1)?.[0];
    expect(body.messages[0]).toEqual({ role: 'user', content: 'Start the interview.' });
    expect(body.output_config.effort).toBe('medium');
    expect(parse.mock.calls.at(-1)?.[1]).toEqual({ timeout: 45_000 });
    expect(body.system[0].text).toContain("Dave's Plastering");
    expect(body.system[0].text).toContain('never invent');
    expect(body.system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(logStructuredAiInteraction).toHaveBeenCalledWith(
      admin,
      expect.objectContaining({
        interactionType: 'lite_interview',
        inputData: { interviewId: view.id, stage: 'areas' },
      }),
    );
    expect(JSON.stringify(logStructuredAiInteraction.mock.calls)).not.toContain('MARKER-SECRET');
  });

  it('keeps the stage when the model is not finished, but still stores what was said', async () => {
    const view = await started();
    parse.mockResolvedValue(
      turn({
        parsed_output: {
          reply: 'Any particular postcodes?',
          stage_complete: false,
          patch: emptyPatch({
            areas: { summary: 'South Manchester', postcodes: [], max_miles: null },
            callout_fee: 60,
          }),
        },
      }),
    );
    const result = await interviewTurn(admin, ctx, { interviewId: view.id, message: 'Callout is about sixty quid' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.view.stage).toBe('areas');
    expect(result.view.draft.callout_fee).toBe(60);
    expect(result.view.draft.day_rate).toBeUndefined();
  });

  it('does not leave pricing without a range, and a visit-only job needs none', async () => {
    const view = await started();
    state.interviews[0].stage = 'pricing';
    state.interviews[0].draft_profile = { job_types: [job({ guide_min: null, guide_max: null })] };
    parse.mockResolvedValue(
      turn({
        parsed_output: {
          reply: 'What is a typical low and high for a skim?',
          stage_complete: true,
          patch: emptyPatch(),
        },
      }),
    );
    const blocked = await interviewTurn(admin, ctx, { interviewId: view.id, message: 'Not sure yet' });
    expect(blocked.ok).toBe(true);
    if (!blocked.ok) return;
    expect(blocked.view.stage).toBe('pricing');

    state.interviews[0].draft_profile = {
      job_types: [job({ how_priced: 'needs_visit', guide_min: null, guide_max: null })],
    };
    parse.mockResolvedValue(
      turn({
        parsed_output: {
          reply: 'Anything you never do?',
          stage_complete: true,
          patch: emptyPatch(),
        },
      }),
    );
    const visit = await interviewTurn(admin, ctx, { interviewId: view.id, message: 'I need to see ceilings first' });
    expect(visit.ok).toBe(true);
    if (!visit.ok) return;
    expect(visit.view.stage).toBe('rules');
  });

  it('keeps the tradie message and asks them to repeat it when the model fails', async () => {
    const view = await started();
    parse.mockRejectedValue(new Error('timeout'));
    const result = await interviewTurn(admin, ctx, { interviewId: view.id, message: 'South Manchester MARKER-SECRET' });
    expect(result).toMatchObject({ ok: false, error: 'ai_failed' });
    if (result.ok || result.error !== 'ai_failed') return;
    expect(result.view.messages.map((message) => message.content)).toEqual([
      expect.stringContaining('Hi Dave!'),
      'South Manchester MARKER-SECRET',
      "Sorry, I lost my train of thought — could you say that again?",
    ]);
    expect(result.view.stage).toBe('areas');
    expect(state.interviews[0].messages).toEqual(result.view.messages);
    expect(JSON.stringify(logStructuredAiInteraction.mock.calls)).not.toContain('MARKER-SECRET');
  });

  it('returns too_long on the 100th stored turn and when the message is over 2,000 characters', async () => {
    const view = await started();
    state.interviews[0].turn_count = 100;
    const capped = await interviewTurn(admin, ctx, { interviewId: view.id, message: 'One more' });
    expect(capped).toEqual({ ok: false, error: 'too_long' });
    expect(parse).not.toHaveBeenCalled();

    state.interviews[0].turn_count = 1;
    const long = await interviewTurn(admin, ctx, { interviewId: view.id, message: 'a'.repeat(2001) });
    expect(long).toEqual({ ok: false, error: 'too_long' });
    expect(parse).not.toHaveBeenCalled();
    expect(state.interviews[0].messages).toEqual(view.messages);
  });

  it('refuses another business and a finished interview, and reports a busy claim', async () => {
    const view = await started();
    const other = await interviewTurn(admin, { ...ctx, tenantId: 'tenant-2' }, { interviewId: view.id, message: 'Hi' });
    expect(other).toEqual({ ok: false, error: 'not_found' });

    state.interviews[0].status = 'finished';
    const done = await interviewTurn(admin, ctx, { interviewId: view.id, message: 'Hi' });
    expect(done).toEqual({ ok: false, error: 'finished' });

    state.interviews[0].status = 'in_progress';
    state.failNextClaim = true;
    const busy = await interviewTurn(admin, ctx, { interviewId: view.id, message: 'Hi' });
    expect(busy).toEqual({ ok: false, error: 'busy' });
  });

  it('does not move past examples into the website step', async () => {
    const view = await started();
    const priced = examples();
    state.interviews[0].stage = 'examples';
    state.interviews[0].draft_profile = { example_jobs: priced, job_types: [job()] };
    state.interviews[0].example_jobs = priced;
    const result = await interviewTurn(admin, ctx, { interviewId: view.id, message: 'Those prices sound right' });
    expect(result).toEqual({ ok: false, error: 'busy' });
    expect(parse).not.toHaveBeenCalled();
    expect(state.interviews[0].stage).toBe('examples');
  });
});

describe('beginExampleChat', () => {
  beforeEach(reset);

  it('asks the first job in the chat, and a price moves on to the next one', async () => {
    state.interviews.push({
      id: 'examples-open',
      tenant_id: 'tenant-1',
      status: 'in_progress',
      stage: 'examples',
      messages: [{ role: 'assistant', content: 'Rules are done.' }],
      draft_profile: { job_types: [job({ key: 'skim', name: 'Skim' })] },
      example_jobs: [],
      turn_count: 4,
    });
    parse.mockResolvedValue({
      stop_reason: 'end_turn',
      parsed_output: {
        examples: [
          { description: 'Skim a small bedroom', job_type_key: 'skim' },
          { description: 'Patch a hallway', job_type_key: 'skim' },
          { description: 'Skim a ceiling', job_type_key: 'skim' },
        ],
      },
      usage: { input_tokens: 3, output_tokens: 4 },
    });
    const started = await beginExampleChat(admin, ctx, 'examples-open');
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(started.view.messages.map((message) => message.content).join('\n')).toContain("that's the profile done");
    expect(started.view.messages.at(-1)?.content).toContain('Skim a small bedroom');
    expect(parse).toHaveBeenCalledTimes(2);

    const again = await beginExampleChat(admin, ctx, 'examples-open');
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.view.messages).toHaveLength(started.view.messages.length);
    expect(parse).toHaveBeenCalledTimes(2);

    parse.mockResolvedValueOnce({
      stop_reason: 'end_turn',
      parsed_output: {
        outcome: 'priced',
        reply: '£180, noted.',
        price: 180,
        reasoning: 'because the walls are sound and it is one room',
        replaces_total: false,
      },
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const priced = await interviewTurn(admin, ctx, {
      interviewId: 'examples-open',
      message: '£180 because the walls are sound and it is one room',
    });
    expect(priced.ok).toBe(true);
    if (!priced.ok) return;
    expect(priced.view.examples).toEqual([
      {
        description: 'Skim a small bedroom',
        price: 180,
        reasoning: 'because the walls are sound and it is one room',
      },
    ]);
    expect(priced.view.messages.at(-1)?.content).toContain('Patch a hallway');
    expect(priced.view.stage).toBe('examples');
  });

  it('answers a request for missing detail instead of repeating the job', async () => {
    state.interviews.push({
      id: 'examples-open',
      tenant_id: 'tenant-1',
      status: 'in_progress',
      stage: 'examples',
      messages: [
        { role: 'assistant', content: "Okay, that's the profile done." },
        { role: 'assistant', content: 'First one. Skim a living room. What would you charge, and why?' },
      ],
      draft_profile: {
        job_types: [job({ key: 'skim', name: 'Skim' })],
        setup_chat: { mode: 'examples', prompts: ['Skim a living room'], cursor: 0 },
      },
      example_jobs: [],
      turn_count: 5,
    });
    parse.mockResolvedValue({
      stop_reason: 'end_turn',
      parsed_output: {
        outcome: 'need_detail',
        reply: 'Call it 5 metres by 4, normal ceiling. What would you charge for that?',
        price: null,
        reasoning: null,
        replaces_total: false,
      },
      usage: { input_tokens: 2, output_tokens: 3 },
    });
    const result = await interviewTurn(admin, ctx, {
      interviewId: 'examples-open',
      message: 'id ask for the dimensions of the room',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.view.examples).toEqual([]);
    expect(result.view.messages.at(-1)?.content).toBe('Call it 5 metres by 4, normal ceiling. What would you charge for that?');
    expect(result.view.messages.at(-1)?.content).not.toContain('A customer says');
    expect(result.view.stage).toBe('examples');
    const prompt = String(parse.mock.calls[0]?.[0].system[0].text);
    expect(prompt).toContain('not a new total');
    expect(prompt).toContain('replaces_total');
    expect(prompt).toContain(ctx.widget.trade);
  });

  it('keeps a total already given when the reason mentions other amounts', async () => {
    state.interviews.push({
      id: 'examples-open',
      tenant_id: 'tenant-1',
      status: 'in_progress',
      stage: 'examples',
      messages: [
        { role: 'assistant', content: 'First one. Change a euro cylinder on a wooden front door. What would you charge, and why?' },
        { role: 'user', content: '£1000' },
        { role: 'assistant', content: 'What made it that amount?' },
      ],
      draft_profile: {
        setup_chat: {
          mode: 'examples',
          prompts: ['Change a euro cylinder on a wooden front door', 'Fit a night latch on a back door'],
          cursor: 0,
          pending_price: 1000,
          detail_version: 2,
        },
      },
      example_jobs: [],
      turn_count: 6,
    });
    parse.mockResolvedValue({
      stop_reason: 'end_turn',
      parsed_output: {
        outcome: 'priced',
        reply: '£1000, noted.',
        price: 40,
        reasoning: '£40 for the cylinder, the rest is labour and the callout',
        replaces_total: false,
      },
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const result = await interviewTurn(admin, ctx, {
      interviewId: 'examples-open',
      message: '£40 for the cylinder, the rest is labour and the callout',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.view.examples).toEqual([
      {
        description: 'Change a euro cylinder on a wooden front door',
        price: 1000,
        reasoning: '£40 for the cylinder, the rest is labour and the callout',
      },
    ]);
    expect(result.view.messages.at(-1)?.content).toContain('Fit a night latch');
    expect(result.view.stage).toBe('examples');
    const prompt = String(parse.mock.calls[0]?.[0].system[0].text);
    expect(prompt).toContain('£1000');
    expect(prompt).toContain('parts');
    const stored = (state.interviews[0].draft_profile as { setup_chat?: { pending_price?: number } }).setup_chat;
    expect(stored?.pending_price).toBeUndefined();
  });

  it('accepts a new total only when they replace the one already given', async () => {
    state.interviews.push({
      id: 'examples-open',
      tenant_id: 'tenant-1',
      status: 'in_progress',
      stage: 'examples',
      messages: [
        { role: 'assistant', content: 'First one. Cut a hedge. What would you charge, and why?' },
        { role: 'user', content: '£1000' },
        { role: 'assistant', content: 'What made it that amount?' },
      ],
      draft_profile: {
        setup_chat: {
          mode: 'examples',
          prompts: ['Cut a hedge', 'Mow a lawn'],
          cursor: 0,
          pending_price: 1000,
          detail_version: 2,
        },
      },
      example_jobs: [],
      turn_count: 6,
    });
    parse.mockResolvedValue({
      stop_reason: 'end_turn',
      parsed_output: {
        outcome: 'priced',
        reply: '£800, noted.',
        price: 800,
        reasoning: 'actually £800, it is a shorter hedge than I thought',
        replaces_total: true,
      },
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const result = await interviewTurn(admin, ctx, {
      interviewId: 'examples-open',
      message: 'actually £800, it is a shorter hedge than I thought',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.view.examples?.[0]?.price).toBe(800);
  });

  it('remembers a price with no reason, and does not move on', async () => {
    state.interviews.push({
      id: 'examples-open',
      tenant_id: 'tenant-1',
      status: 'in_progress',
      stage: 'examples',
      messages: [{ role: 'assistant', content: 'First one. Clean eight windows. What would you charge, and why?' }],
      draft_profile: {
        setup_chat: {
          mode: 'examples',
          prompts: ['Clean eight windows', 'Clean a conservatory'],
          cursor: 0,
          detail_version: 2,
        },
      },
      example_jobs: [],
      turn_count: 5,
    });
    parse.mockResolvedValue({
      stop_reason: 'end_turn',
      parsed_output: {
        outcome: 'need_reason',
        reply: 'What made it that amount?',
        price: 250,
        reasoning: null,
        replaces_total: false,
      },
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const result = await interviewTurn(admin, ctx, { interviewId: 'examples-open', message: '£250' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.view.examples).toEqual([]);
    expect(result.view.stage).toBe('examples');
    expect(result.view.messages.at(-1)?.content).toBe('What made it that amount?');
    expect(result.view.messages.at(-1)?.content).not.toContain('Clean a conservatory');
    const stored = (state.interviews[0].draft_profile as { setup_chat?: { pending_price?: number } }).setup_chat;
    expect(stored?.pending_price).toBe(250);
  });

  it('does not end the examples when they want to stop before three prices', async () => {
    state.interviews.push({
      id: 'examples-open',
      tenant_id: 'tenant-1',
      status: 'in_progress',
      stage: 'examples',
      messages: [{ role: 'assistant', content: 'First one. Cut a lawn. What would you charge, and why?' }],
      draft_profile: {
        setup_chat: {
          mode: 'examples',
          prompts: ['Cut a lawn', 'Weed a border', 'Trim a hedge'],
          cursor: 0,
          detail_version: 2,
        },
      },
      example_jobs: [],
      turn_count: 5,
    });
    parse.mockResolvedValue({
      stop_reason: 'end_turn',
      parsed_output: {
        outcome: 'skip_rest',
        reply: "Okay, we'll stop there.",
        price: null,
        reasoning: null,
        replaces_total: false,
      },
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const result = await interviewTurn(admin, ctx, { interviewId: 'examples-open', message: 'skip the rest' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.view.stage).toBe('examples');
    expect(result.view.examples).toEqual([]);
    expect(result.view.messages.at(-1)?.content).toContain('I still need a few priced jobs');
    expect(result.view.messages.at(-1)?.content).not.toContain("we'll stop there");
  });

  it('adds the facts this trade needs to the job already on screen', async () => {
    state.interviews.push({
      id: 'examples-open',
      tenant_id: 'tenant-1',
      status: 'in_progress',
      stage: 'examples',
      messages: [
        {
          role: 'assistant',
          content:
            '£350, noted. Next one. Board and plaster three rooms in a house extension. What would you charge, and why?',
        },
      ],
      draft_profile: {
        setup_chat: {
          mode: 'examples',
          prompts: ['Skim a small bedroom, about 3 metres by 3', 'Board and plaster three rooms in a house extension'],
          cursor: 1,
          detail_version: 1,
        },
      },
      example_jobs: [],
      turn_count: 6,
    });
    parse.mockResolvedValue({
      stop_reason: 'end_turn',
      parsed_output: {
        examples: [{ description: 'Board and plaster three rooms, each about 4 metres by 3, after the rewiring.' }],
      },
      usage: { input_tokens: 1, output_tokens: 2 },
    });
    const result = await fillExampleDetail(admin, ctx, 'examples-open');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.view.messages.at(-1)?.content).toContain('Next one.');
    expect(result.view.messages.at(-1)?.content).toContain('4 metres by 3');
    expect(parse.mock.calls[0]?.[0].system[0].text).toContain('window cleaner');
    expect(parse.mock.calls[0]?.[0].system[0].text).toContain('locksmith');
    await fillExampleDetail(admin, ctx, 'examples-open');
    expect(parse).toHaveBeenCalledTimes(1);
  });
});

describe('saveExampleJobs and saveWebsiteStep', () => {
  beforeEach(reset);

  it('rejects a price of zero or a short reason, and stores three good ones', async () => {
    const view = await getOrStartInterview(admin, ctx);
    const badPrice = await saveExampleJobs(admin, ctx, {
      interviewId: view.id,
      examples: [{ description: 'A ceiling', price: 0, reasoning: 'Too cheap to be real' }],
    });
    expect(badPrice).toEqual({ ok: false, error: 'Each example needs a price above £0.' });
    const badReason = await saveExampleJobs(admin, ctx, {
      interviewId: view.id,
      examples: [{ description: 'A ceiling', price: 90, reasoning: 'no' }],
    });
    expect(badReason.ok).toBe(false);
    expect(state.interviews[0].example_jobs).toEqual([]);

    const saved = await saveExampleJobs(admin, ctx, { interviewId: view.id, examples: examples() });
    expect(saved).toEqual({ ok: true });
    expect(state.interviews[0].example_jobs).toHaveLength(3);
    expect((state.interviews[0].draft_profile as DraftProfile).example_jobs).toHaveLength(3);
  });

  it('checks the website, the sign-off name and the mobile before writing', async () => {
    const view = await getOrStartInterview(admin, ctx);
    const badSite = await saveWebsiteStep(admin, ctx, {
      interviewId: view.id,
      website: 'not a website',
      signOffName: 'Dave',
      ownerMobile: null,
    });
    expect(badSite).toEqual({
      ok: false,
      field: 'website',
      error: "That doesn't look like a website address — try something like daveplastering.co.uk",
    });
    expect(state.widgets[0].website_url).toBeNull();

    const longName = await saveWebsiteStep(admin, ctx, {
      interviewId: view.id,
      website: 'daveplastering.co.uk',
      signOffName: 'D'.repeat(41),
      ownerMobile: null,
    });
    expect(longName).toMatchObject({ ok: false, field: 'signOffName' });

    const landline = await saveWebsiteStep(admin, ctx, {
      interviewId: view.id,
      website: 'https://www.daveplastering.co.uk/contact',
      signOffName: 'Dave',
      ownerMobile: '020 7946 0958',
    });
    expect(landline).toMatchObject({ ok: false, field: 'ownerMobile' });
    expect(state.widgets[0].allowed_domains).toEqual([]);

    const saved = await saveWebsiteStep(admin, ctx, {
      interviewId: view.id,
      website: 'https://www.daveplastering.co.uk/contact',
      signOffName: '  Dave  ',
      ownerMobile: '07700 900123',
    });
    expect(saved).toEqual({ ok: true });
    expect(state.widgets[0]).toMatchObject({
      allowed_domains: ['daveplastering.co.uk'],
      website_url: 'daveplastering.co.uk',
      sign_off_name: 'Dave',
      owner_mobile_e164: '+447700900123',
    });
    expect(state.interviews[0].stage).toBe('website');
    expect(state.profiles).toHaveLength(0);
  });
});

describe('finishInterview', () => {
  beforeEach(reset);

  function readyInterview() {
    state.interviews.push({
      id: 'interview-1',
      tenant_id: 'tenant-1',
      status: 'in_progress',
      stage: 'website',
      messages: [],
      draft_profile: {
        areas: liveProfile.areas,
        callout_fee: 40,
        job_types: [job({ auto_accept: true }), job({ key: 'ceiling', name: 'Ceiling', how_priced: 'needs_visit', guide_min: null, guide_max: null })],
        rules: ['No Sundays'],
        materials: 'Customer buys the plaster',
        tone: 'Warm',
        example_jobs: examples(),
      },
      example_jobs: examples(),
      turn_count: 4,
    });
    state.widgets[0].website_url = 'daveplastering.co.uk';
  }

  it('validates before anything goes live, then a second finish keeps the same version', async () => {
    readyInterview();
    state.interviews[0].example_jobs = examples(2);
    (state.interviews[0].draft_profile as DraftProfile).example_jobs = examples(2);
    const early = await finishInterview(admin, ctx, 'interview-1');
    expect(early).toEqual({ ok: false, missing: ['Price at least 3 example jobs.'] });
    expect(state.profiles).toHaveLength(0);
    expect(state.interviews[0].status).toBe('in_progress');

    state.interviews[0].example_jobs = examples();
    (state.interviews[0].draft_profile as DraftProfile).example_jobs = examples();
    const done = await finishInterview(admin, ctx, 'interview-1');
    expect(done).toEqual({ ok: true, version: 1 });
    const saved = state.profiles[0].profile as PriceProfile;
    expect(PriceProfileSchema.safeParse(saved).success).toBe(true);
    expect(saved.job_types[0].auto_accept).toBe(true);
    expect(saved.job_types[1].auto_accept).toBe(false);
    expect(state.interviews[0]).toMatchObject({ status: 'finished', stage: 'done' });

    const again = await finishInterview(admin, ctx, 'interview-1');
    expect(again).toEqual({ ok: true, version: 1 });
    expect(state.profiles).toHaveLength(1);
    expect(state.profiles[0].version).toBe(1);
  });

  it('leaves the interview in progress when the profile save fails, and still succeeds if the finish raced', async () => {
    readyInterview();
    state.upsertError = true;
    const failed = await finishInterview(admin, ctx, 'interview-1');
    expect(failed.ok).toBe(false);
    expect(state.interviews[0].status).toBe('in_progress');
    expect(state.profiles).toHaveLength(0);

    state.upsertError = false;
    state.finishMiss = true;
    const raced = await finishInterview(admin, ctx, 'interview-1');
    expect(raced).toEqual({ ok: true, version: 1 });
    expect(state.interviews[0].status).toBe('in_progress');
  });
});
