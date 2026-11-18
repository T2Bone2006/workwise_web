import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));

import { attachNetworkInfo, type JobRow } from '@/lib/data/jobs';

function job(id: string, dispatchId: string | null): JobRow {
  return {
    id,
    tenant_id: 't',
    customer_id: null,
    assigned_worker_id: null,
    reference_number: id,
    address: null,
    status: 'pending',
    priority: 'normal',
    scheduled_date: null,
    scheduled_time: null,
    created_at: '2026-11-18T10:00:00Z',
    updated_at: null,
    customer_name: null,
    worker_name: null,
    network_dispatch_id: dispatchId,
  };
}

function client(result: { data?: unknown; error?: { message: string } | null }) {
  const inFn = vi.fn().mockResolvedValue({ data: result.data ?? null, error: result.error ?? null });
  const select = vi.fn().mockReturnValue({ in: inFn });
  const from = vi.fn().mockReturnValue({ select });
  return { supabase: { from }, from, inFn };
}

describe('attachNetworkInfo', () => {
  it('tags a job you sent with the partner you sent it to, and one you received with who sent it', async () => {
    const { supabase } = client({
      data: [
        { id: 'd1', originating_tenant_id: 'me', receiving_tenant_id: 'acme', originating_tenant: { name: 'Me Ltd' }, receiving_tenant: { name: 'Acme Ltd' } },
        { id: 'd2', originating_tenant_id: 'bolt', receiving_tenant_id: 'me', originating_tenant: { name: 'Bolt Plumbing' }, receiving_tenant: { name: 'Me Ltd' } },
      ],
    });
    const jobs = [job('a', 'd1'), job('b', 'd2'), job('c', null)];
    await attachNetworkInfo(supabase, 'me', jobs);
    expect(jobs[0].network).toEqual({ direction: 'sent', partnerName: 'Acme Ltd' });
    expect(jobs[1].network).toEqual({ direction: 'received', partnerName: 'Bolt Plumbing' });
    expect(jobs[2].network).toBeUndefined();
  });

  it('asks nothing when no job on the page crossed the network', async () => {
    const { supabase, from } = client({ data: [] });
    await attachNetworkInfo(supabase, 'me', [job('a', null)]);
    expect(from).not.toHaveBeenCalled();
  });

  it('leaves rows untagged and does not throw when the lookup fails', async () => {
    const { supabase } = client({ error: { message: 'boom' } });
    const jobs = [job('a', 'd1')];
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(attachNetworkInfo(supabase, 'me', jobs)).resolves.toBeUndefined();
    expect(jobs[0].network).toBeUndefined();
    quiet.mockRestore();
  });
});
