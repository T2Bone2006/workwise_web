import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssistantCtx } from '@/lib/assistant/caller';
import type { ActionRow } from '@/lib/assistant/store';

const execute = vi.fn();
const undo = vi.fn();
const rows = new Map<string, ActionRow>();

vi.mock('@/lib/assistant/registry', () => ({
  ACTIONS_BY_KIND: new Map([
    ['move_visits', { name: 'move_visits', product: 'rounds', execute, undo }],
    ['set_lead_status', { name: 'set_lead_status', product: 'lite', execute }],
  ]),
}));

vi.mock('@/lib/assistant/store', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/assistant/store')>();
  return {
    ...real,
    touchConversation: vi.fn(async () => undefined),
    getAction: vi.fn(async (_admin: unknown, p: { id: string; userId: string }) => {
      const row = rows.get(p.id);
      return row && row.user_id === p.userId ? { ...row } : null;
    }),
    claimAction: vi.fn(async (_admin: unknown, id: string, from: string, to: string) => {
      const row = rows.get(id);
      if (!row || row.status !== from) return false;
      rows.set(id, { ...row, status: to as ActionRow['status'], decided_at: new Date().toISOString() });
      return true;
    }),
    finishAction: vi.fn(async (_admin: unknown, id: string, p: { status: ActionRow['status']; result?: ActionRow['result']; error?: string | null; changeId?: string | null }) => {
      const row = rows.get(id)!;
      const next = { ...row, status: p.status, error: p.error ?? null, ...(p.result !== undefined ? { result: p.result } : {}), ...(p.changeId !== undefined ? { change_id: p.changeId } : {}) };
      rows.set(id, next);
      return next;
    }),
  };
});

const { decideAction } = await import('@/lib/assistant/decide');

const ctx = { userId: 'u1', tenantId: 't1', hasRounds: true, hasLite: false, admin: {}, db: {} } as unknown as AssistantCtx;

function seed(over: Partial<ActionRow> = {}) {
  rows.set('a1', {
    id: 'a1',
    conversation_id: 'c1',
    tenant_id: 't1',
    user_id: 'u1',
    tool_use_id: 'tu',
    kind: 'move_visits',
    params: { visitIds: ['v1'], toDate: '2026-10-09' },
    preview: { title: 'Move Mrs Smith to Fri 9 Oct', lines: [], confirmLabel: 'Move it', tone: 'sky' },
    status: 'pending',
    result: null,
    error: null,
    change_id: null,
    created_at: new Date().toISOString(),
    decided_at: null,
    noted_at: null,
    ...over,
  });
}

beforeEach(() => {
  rows.clear();
  execute.mockReset();
  undo.mockReset();
});

describe('decideAction', () => {
  it('runs the change once on Do it, with the saved params', async () => {
    seed();
    execute.mockResolvedValue({ ok: true, result: 'Moved 1 visit to Fri 9 Oct.', changeId: 'ch1' });
    const first = await decideAction(ctx, 'a1', 'confirm');
    expect(first.status).toBe(200);
    expect(first.body.action).toMatchObject({ status: 'done', result: 'Moved 1 visit to Fri 9 Oct.', canUndo: true });
    expect(execute).toHaveBeenCalledWith(ctx, { visitIds: ['v1'], toDate: '2026-10-09' }, 'a1');

    const second = await decideAction(ctx, 'a1', 'confirm');
    expect(second.status).toBe(409);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(rows.get('a1')!.change_id).toBe('ch1');
  });

  it('records a failure and changes nothing else', async () => {
    seed();
    execute.mockResolvedValue({ ok: false, error: 'Pick today or a later day.' });
    const r = await decideAction(ctx, 'a1', 'confirm');
    expect(r.body.action).toMatchObject({ status: 'failed', error: 'Pick today or a later day.' });
  });

  it('catches a crash as a failure', async () => {
    seed();
    execute.mockRejectedValue(new Error('boom'));
    const r = await decideAction(ctx, 'a1', 'confirm');
    expect(r.body.action?.status).toBe('failed');
  });

  it('cancels a pending card without running it', async () => {
    seed();
    const r = await decideAction(ctx, 'a1', 'cancel');
    expect(r.body.action?.status).toBe('cancelled');
    expect(execute).not.toHaveBeenCalled();
    expect((await decideAction(ctx, 'a1', 'confirm')).status).toBe(409);
  });

  it('will not run a card older than a day', async () => {
    seed({ created_at: new Date(Date.now() - 25 * 3600 * 1000).toISOString() });
    const r = await decideAction(ctx, 'a1', 'confirm');
    expect(r.body.action?.status).toBe('expired');
    expect(execute).not.toHaveBeenCalled();
  });

  it('undoes a done change with what was saved', async () => {
    seed({ status: 'done', decided_at: new Date().toISOString(), change_id: 'ch1', result: { text: 'Moved.', data: {} } });
    undo.mockResolvedValue({ ok: true, result: 'Put 1 visit back.' });
    const r = await decideAction(ctx, 'a1', 'undo');
    expect(r.body.action).toMatchObject({ status: 'undone', result: 'Put 1 visit back.' });
    expect(undo).toHaveBeenCalledWith(ctx, { visitIds: ['v1'], toDate: '2026-10-09' }, { data: {}, changeId: 'ch1' });
  });

  it('keeps the change done when Undo fails', async () => {
    seed({ status: 'done', decided_at: new Date().toISOString(), change_id: 'ch1', result: { text: 'Moved.' } });
    undo.mockResolvedValue({ ok: false, error: 'Too old to undo' });
    const r = await decideAction(ctx, 'a1', 'undo');
    expect(r.body.action).toMatchObject({ status: 'done', error: "Couldn't undo: Too old to undo" });
  });

  it("refuses someone else's card and a product they don't have", async () => {
    seed({ user_id: 'someone-else' });
    expect((await decideAction(ctx, 'a1', 'confirm')).status).toBe(404);
    seed({ kind: 'set_lead_status' });
    expect((await decideAction(ctx, 'a1', 'confirm')).status).toBe(403);
  });
});
