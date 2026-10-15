import { describe, expect, it } from 'vitest';
import { applyPricingChanges } from '@/lib/assistant/actions/lite';
import { buildSystemPrompt, contextLine } from '@/lib/assistant/prompt';
import { anthropicTools, toolsFor } from '@/lib/assistant/registry';
import { toApiMessages } from '@/lib/assistant/run-turn';
import type { AssistantAction } from '@/lib/assistant/shared';
import { actionCard, renderTurns, type ActionRow, type MessageRow } from '@/lib/assistant/store';
import type { PriceProfile } from '@/lib/lite/profile-schema';

const profile: PriceProfile = {
  areas: { summary: 'Bristol north', postcodes: ['BS7'], max_miles: 10 },
  callout_fee: 50,
  hourly_rate: null,
  day_rate: null,
  minimum_charge: null,
  materials: 'Included',
  job_types: [
    { key: 'patch-repair', name: 'Patch repair', how_priced: 'from_description', guide_min: 70, guide_max: 120, what_changes_price: 'Size', auto_accept: true },
    { key: 'ceilings', name: 'Ceilings', how_priced: 'needs_visit', guide_min: null, guide_max: null, what_changes_price: '', auto_accept: false },
  ],
  rules: ['No work above two storeys', 'Cash or bank transfer only'],
  example_jobs: [],
  tone: 'Friendly',
};

describe('applyPricingChanges (plain-words price updates)', () => {
  it('changes a rate and a range, and says what changed', () => {
    const r = applyPricingChanges(profile, [
      { op: 'set_rate', rate: 'callout_fee', amount: 60 },
      { op: 'set_work', name: 'patch repair', guide_min: 80, guide_max: 130 },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.profile.callout_fee).toBe(60);
    expect(r.profile.job_types[0]).toMatchObject({ guide_min: 80, guide_max: 130, auto_accept: true });
    expect(r.lines).toEqual(['Callout fee: £50 → £60', 'Patch repair: £70–£120 → £80–£130']);
    expect(profile.callout_fee).toBe(50); // the original is untouched
  });

  it('adds new work with a fresh key and never auto-accepts it', () => {
    const r = applyPricingChanges(profile, [{ op: 'set_work', name: 'Skimming', guide_min: 200, guide_max: 400 }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const added = r.profile.job_types.find((j) => j.name === 'Skimming');
    expect(added).toMatchObject({ key: 'skimming', how_priced: 'from_description', auto_accept: false });
  });

  it('switching work to needs-a-visit turns auto-accept off', () => {
    const r = applyPricingChanges(profile, [{ op: 'set_work', name: 'Patch repair', how_priced: 'needs_visit' }]);
    expect(r.ok && r.profile.job_types[0]!.auto_accept).toBe(false);
  });

  it('removes a rule by its words and refuses a rule that is not there', () => {
    const r = applyPricingChanges(profile, [{ op: 'remove_rule', text: 'two storeys' }]);
    expect(r.ok && r.profile.rules).toEqual(['Cash or bank transfer only']);
    expect(applyPricingChanges(profile, [{ op: 'remove_rule', text: 'weekends' }]).ok).toBe(false);
  });

  it('refuses a change that leaves no kinds of work', () => {
    const r = applyPricingChanges(profile, [
      { op: 'remove_work', key: 'patch-repair' },
      { op: 'remove_work', key: 'ceilings' },
    ]);
    expect(r.ok).toBe(false);
  });

  it('refuses a range that runs backwards', () => {
    expect(applyPricingChanges(profile, [{ op: 'set_work', name: 'Patch repair', guide_min: 200, guide_max: 100 }]).ok).toBe(false);
  });
});

describe('toApiMessages', () => {
  const q = (text: string): Pick<MessageRow, 'role' | 'content'> => ({ role: 'user', content: [{ type: 'text', text }] });

  it('replays history exactly as saved', () => {
    const rows: Pick<MessageRow, 'role' | 'content'>[] = [
      q('hi'),
      { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'who_owes', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: '{}' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'Nobody' }] },
    ];
    expect(toApiMessages(rows)).toEqual(rows);
  });

  it('fills in a tool answer that never got saved, the same way every time', () => {
    const rows: Pick<MessageRow, 'role' | 'content'>[] = [
      q('hi'),
      { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'who_owes', input: {} }] },
      q('again'),
    ];
    const out = toApiMessages(rows);
    expect(out).toHaveLength(4);
    expect(out[2]).toEqual({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 't1', content: 'Interrupted before this ran.', is_error: true }],
    });
    expect(toApiMessages(rows)).toEqual(out);
  });
});

function actionRow(over: Partial<ActionRow> = {}): ActionRow {
  return {
    id: 'a1',
    conversation_id: 'c1',
    tenant_id: 't',
    user_id: 'u',
    tool_use_id: 'tu',
    kind: 'move_visits',
    params: {},
    preview: { title: 'Move 2 visits to Thu 8 Oct', lines: ['A', 'B'], confirmLabel: 'Move them', tone: 'sky' },
    status: 'pending',
    result: null,
    error: null,
    change_id: null,
    created_at: '2026-10-07T09:00:00.000Z',
    decided_at: null,
    noted_at: null,
    ...over,
  };
}

describe('actionCard', () => {
  const now = new Date('2026-10-07T10:00:00.000Z');
  it('shows a pending card as it was prepared', () => {
    expect(actionCard(actionRow(), true, now)).toMatchObject({ status: 'pending', confirmLabel: 'Move them', canUndo: false });
  });
  it('expires a card nobody tapped for a day', () => {
    expect(actionCard(actionRow(), true, new Date('2026-10-08T09:30:00.000Z')).status).toBe('expired');
  });
  it('offers Undo only on a done change that has one, for a day', () => {
    const done = actionRow({ status: 'done', decided_at: '2026-10-07T09:05:00.000Z', result: { text: 'Moved 2 visits.' } });
    expect(actionCard(done, true, now)).toMatchObject({ canUndo: true, result: 'Moved 2 visits.' });
    expect(actionCard(done, false, now).canUndo).toBe(false);
    expect(actionCard(done, true, new Date('2026-10-08T10:00:00.000Z')).canUndo).toBe(false);
  });
});

describe('renderTurns', () => {
  it('joins everything after a question into one answer and draws actions fresh', () => {
    const action: AssistantAction = { id: 'a1', kind: 'move_visits', status: 'done', title: 'Move', lines: [], confirmLabel: 'Move', tone: 'sky', canUndo: true };
    const rows: MessageRow[] = [
      { id: 'm1', seq: 1, role: 'user', kind: 'question', content: [], ui: { parts: [{ type: 'text', text: 'Move Mrs Smith' }] }, created_at: 'x' },
      { id: 'm2', seq: 2, role: 'assistant', kind: 'answer', content: [], ui: { parts: [{ type: 'text', text: 'Here you go' }] }, created_at: 'x' },
      { id: 'm3', seq: 3, role: 'user', kind: 'tool_results', content: [], ui: { parts: [{ type: 'action', id: 'a1' }, { type: 'action', id: 'gone' }] }, created_at: 'x' },
      { id: 'm4', seq: 4, role: 'assistant', kind: 'answer', content: [], ui: null, created_at: 'x' },
    ];
    const turns = renderTurns(rows, new Map([['a1', action]]));
    expect(turns).toHaveLength(2);
    expect(turns[0]).toMatchObject({ role: 'user', parts: [{ type: 'text', text: 'Move Mrs Smith' }] });
    expect(turns[1]!.parts).toEqual([{ type: 'text', text: 'Here you go' }, { type: 'action', action }]);
  });
});

describe('tools and prompt', () => {
  it('gives each product only its own tools, in a fixed order', () => {
    const rounds = toolsFor({ rounds: true, lite: false }).map((t) => t.name);
    const lite = toolsFor({ rounds: false, lite: true }).map((t) => t.name);
    expect(rounds).toContain('move_visits');
    expect(rounds).not.toContain('update_pricing');
    expect(lite).toEqual(['how_to', 'list_leads', 'get_pricing', 'set_lead_status', 'update_pricing']);
    expect(toolsFor({ rounds: true, lite: true }).map((t) => t.name)).toEqual([...rounds, ...lite.slice(1)]);
    expect(new Set(rounds).size).toBe(rounds.length);
  });

  it('turns every tool schema into an object JSON schema', () => {
    for (const tool of anthropicTools(toolsFor({ rounds: true, lite: true }))) {
      expect(tool.input_schema.type).toBe('object');
      expect(tool.input_schema).not.toHaveProperty('$schema');
      expect(tool.description?.length ?? 0).toBeGreaterThan(20);
    }
  });

  it('keeps the phone prompt free of anything to buy', () => {
    const phone = buildSystemPrompt({ hasRounds: true, hasLite: false, surface: 'phone' });
    const web = buildSystemPrompt({ hasRounds: true, hasLite: false, surface: 'web' });
    expect(phone).toContain('Never mention buying anything');
    expect(phone).not.toContain('Clear View');
    expect(web).not.toContain('Never mention buying anything');
    expect(web).not.toContain('update_pricing');
  });

  it('starts each question with the date and the page', () => {
    const line = contextLine('2026-10-07', { path: '/customers/abc', customerId: '11111111-1111-1111-1111-111111111111' });
    expect(line).toContain('Wednesday 7 October 2026 (2026-10-07)');
    expect(line).toContain('Tomorrow is 2026-10-08');
    expect(line).toContain('customer_id 11111111-1111-1111-1111-111111111111');
  });
});

describe('answer formatting and screen notes', () => {
  it('splits an intro line from the list under it, and keeps tables whole', async () => {
    const { groupLines } = await import('@/components/assistant/message-text');
    const groups = groupLines('Payments came in like this:\n- Cash: £510\n- Card: £249\n\n| | Aug | Sep |\n|---|---|---|\n| In | £1 | £2 |');
    expect(groups.map((g) => g.kind)).toEqual(['p', 'ul', 'table']);
    expect(groups[1]!.lines).toHaveLength(2);
    expect(groups[2]!.lines).toHaveLength(3);
  });

  it('says exactly what a card shows, including what it left off', async () => {
    const { describeCard } = await import('@/lib/assistant/run-turn');
    expect(
      describeCard({ type: 'map', title: 'Your customers', stops: [{ id: 'a', order: 1, customer: 'A', address: '', lat: 1, lng: 1, status: 'to_do' }], missing: 2, approximate: 1 }),
    ).toBe('a map with 1 places (2 could not be placed and are left off) (1 placed by postcode area only)');
  });
});
