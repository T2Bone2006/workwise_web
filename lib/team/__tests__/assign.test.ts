import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  giveRoundOnDay,
  releaseVisitsToOwner,
  reassignVisits,
  repointAgreementVisits,
  repointRoundVisits,
  setUsualLead,
  validAssignees,
  CANNOT_TAKE_VISITS,
} from '@/lib/team/assign';
import { leadForCustomer, loadRoundLeads } from '@/lib/team/round-leads';
import { undoVisitChangeCore } from '@/lib/rounds/visit-changes';
import { fakeDb, type FakeDb } from './fake-db';

const T = 'tenant-1';
const TODAY = '2026-10-12';
const ACTOR = { userId: 'owner-user', workerId: 'w-owner' };

function seed(): FakeDb {
  return fakeDb({
    workers: [
      { id: 'w-owner', primary_tenant_id: T, worker_type: 'platform_solo', invite_status: 'accepted', full_name: 'Sam Owner' },
      { id: 'w-dave', primary_tenant_id: T, worker_type: 'employee', invite_status: 'accepted', full_name: 'Dave' },
      { id: 'w-lee', primary_tenant_id: T, worker_type: 'employee', invite_status: 'accepted', full_name: 'Lee' },
      { id: 'w-gone', primary_tenant_id: T, worker_type: 'employee', invite_status: 'deactivated', full_name: 'Gone' },
    ],
    team_people: [
      { id: 'p-dave', tenant_id: T, kind: 'lead', worker_id: 'w-dave', name: 'Dave', ended_at: null },
      { id: 'p-lee', tenant_id: T, kind: 'lead', worker_id: 'w-lee', name: 'Lee', ended_at: null },
      { id: 'p-gone', tenant_id: T, kind: 'lead', worker_id: 'w-gone', name: 'Gone', ended_at: null },
      { id: 'p-helper', tenant_id: T, kind: 'helper', worker_id: null, name: 'Helper', ended_at: null },
    ],
    rounds: [
      { id: 'r-tue', tenant_id: T, usual_lead_worker_id: 'w-dave' },
      { id: 'r-mon', tenant_id: T, usual_lead_worker_id: null },
    ],
    service_agreements: [
      { id: 'a1', tenant_id: T, customer_id: 'c1', round_id: 'r-tue', status: 'active' },
      { id: 'a2', tenant_id: T, customer_id: 'c2', round_id: 'r-tue', status: 'active' },
      { id: 'a3', tenant_id: T, customer_id: 'c3', round_id: 'r-mon', status: 'active' },
    ],
    jobs: [
      { id: 'j1', tenant_id: T, service_agreement_id: 'a1', assigned_worker_id: 'w-dave', status: 'assigned', scheduled_date: '2026-10-13' },
      { id: 'j2', tenant_id: T, service_agreement_id: 'a2', assigned_worker_id: 'w-dave', status: 'assigned', scheduled_date: '2026-10-13' },
      { id: 'j3', tenant_id: T, service_agreement_id: 'a1', assigned_worker_id: 'w-dave', status: 'completed', scheduled_date: '2026-10-13' },
      { id: 'j4', tenant_id: T, service_agreement_id: 'a3', assigned_worker_id: 'w-dave', status: 'assigned', scheduled_date: '2026-10-13' },
      { id: 'j5', tenant_id: T, service_agreement_id: 'a1', assigned_worker_id: 'w-dave', status: 'assigned', scheduled_date: '2026-10-20' },
      { id: 'j6', tenant_id: T, service_agreement_id: 'a1', assigned_worker_id: 'w-dave', status: 'assigned', scheduled_date: '2026-10-01' },
    ],
  }, { defaults: { visit_changes: { created_at: new Date().toISOString(), undone_at: null } } });
}

let db: FakeDb;
beforeEach(() => {
  db = seed();
});

const assigned = () => Object.fromEntries(db.rows('jobs').map((j) => [j.id, j.assigned_worker_id]));

describe('validAssignees', () => {
  it('is the owner and live leads; never a helper, an ended or a deactivated lead', async () => {
    const list = await validAssignees(db.client, T);
    expect(list.map((a) => a.workerId).sort()).toEqual(['w-dave', 'w-lee', 'w-owner']);
    expect(list.find((a) => a.workerId === 'w-owner')).toMatchObject({ isOwner: true, name: 'Sam Owner' });
  });
});

describe('reassignVisits', () => {
  it('gives only open visits dated today or later, logs one reassign change, and writes history', async () => {
    const result = await reassignVisits(db.client, { tenantId: T, jobIds: ['j1', 'j3', 'j6'], toWorkerId: 'w-lee', actor: ACTOR, today: TODAY });
    expect(result).toMatchObject({ success: true, moved: 1 });
    expect(assigned()).toMatchObject({ j1: 'w-lee', j3: 'w-dave', j6: 'w-dave' });
    const change = db.rows('visit_changes')[0];
    expect(change).toMatchObject({ kind: 'reassign', tenant_id: T, from_date: '2026-10-13', to_date: null, notify_customers: false });
    expect(change.job_ids).toEqual(['j1']);
    const before = (change.before as Array<Record<string, unknown>>)[0];
    expect(before).toMatchObject({ job_id: 'j1', assigned_worker_id: 'w-dave', after_worker_id: 'w-lee' });
    expect(db.rows('job_status_history')).toHaveLength(1);
  });

  it('a replay moves nothing and records nothing', async () => {
    await reassignVisits(db.client, { tenantId: T, jobIds: ['j1'], toWorkerId: 'w-lee', actor: ACTOR, today: TODAY });
    const again = await reassignVisits(db.client, { tenantId: T, jobIds: ['j1'], toWorkerId: 'w-lee', actor: ACTOR, today: TODAY });
    expect(again).toEqual({ success: true, moved: 0, changeId: null });
    expect(db.rows('visit_changes')).toHaveLength(1);
  });

  it('refuses a helper, a removed lead, an unknown person and another business’s person', async () => {
    for (const to of ['p-helper', 'w-gone', 'w-nobody']) {
      expect(await reassignVisits(db.client, { tenantId: T, jobIds: ['j1'], toWorkerId: to, actor: ACTOR, today: TODAY })).toEqual({
        success: false,
        error: CANNOT_TAKE_VISITS,
      });
    }
    expect((await reassignVisits(db.client, { tenantId: 'other', jobIds: ['j1'], toWorkerId: 'w-lee', actor: ACTOR, today: TODAY })).success).toBe(false);
    expect(assigned().j1).toBe('w-dave');
  });

  it('does not touch another business’s visits', async () => {
    db.rows('jobs').push({ id: 'jx', tenant_id: 'other', assigned_worker_id: 'w-dave', status: 'assigned', scheduled_date: '2026-10-13' });
    const r = await reassignVisits(db.client, { tenantId: T, jobIds: ['jx'], toWorkerId: 'w-lee', actor: ACTOR, today: TODAY });
    expect(r).toEqual({ success: true, moved: 0, changeId: null });
    expect(assigned().jx).toBe('w-dave');
  });

  it('Undo gives the visit back, but leaves one that has since been finished or moved on', async () => {
    const result = await reassignVisits(db.client, { tenantId: T, jobIds: ['j1', 'j2'], toWorkerId: 'w-lee', actor: ACTOR, today: TODAY });
    if (!result.success || !result.changeId) throw new Error('expected a change');
    db.rows('jobs').find((j) => j.id === 'j2')!.status = 'completed';
    const undone = await undoVisitChangeCore(db.client, { tenantId: T, changeId: result.changeId, actor: ACTOR });
    expect(undone).toMatchObject({ success: true, restored: 1, leftAlone: 1 });
    expect(assigned()).toMatchObject({ j1: 'w-dave', j2: 'w-lee' });
  });
});

describe('giveRoundOnDay', () => {
  it('moves the person’s open visits on that date only', async () => {
    const r = await giveRoundOnDay(db.client, { tenantId: T, date: '2026-10-13', fromWorkerId: 'w-dave', toWorkerId: 'w-lee', actor: ACTOR, today: TODAY });
    expect(r).toMatchObject({ success: true, moved: 3 });
    expect(assigned()).toMatchObject({ j1: 'w-lee', j2: 'w-lee', j3: 'w-dave', j4: 'w-lee', j5: 'w-dave' });
  });

  it('can be limited to one named round', async () => {
    const r = await giveRoundOnDay(db.client, { tenantId: T, date: '2026-10-13', fromWorkerId: 'w-dave', toWorkerId: 'w-lee', roundId: 'r-tue', actor: ACTOR, today: TODAY });
    expect(r).toMatchObject({ success: true, moved: 2 });
    expect(assigned()).toMatchObject({ j1: 'w-lee', j2: 'w-lee', j4: 'w-dave' });
  });

  it('an empty round moves nothing', async () => {
    db.rows('rounds').push({ id: 'r-empty', tenant_id: T, usual_lead_worker_id: null });
    expect(await giveRoundOnDay(db.client, { tenantId: T, date: '2026-10-13', fromWorkerId: 'w-dave', toWorkerId: 'w-lee', roundId: 'r-empty', actor: ACTOR, today: TODAY })).toEqual({
      success: true,
      moved: 0,
      changeId: null,
    });
  });
});

describe('usual lead', () => {
  it('loadRoundLeads reads only rounds that have a lead', async () => {
    expect([...(await loadRoundLeads(db.client, T)).entries()]).toEqual([['r-tue', 'w-dave']]);
  });

  it('leadForCustomer answers only when all the customer’s rounds agree', async () => {
    expect(await leadForCustomer(db.client, T, 'c1')).toBe('w-dave');
    expect(await leadForCustomer(db.client, T, 'c3')).toBeNull(); // round with no lead
    db.rows('service_agreements').push({ id: 'a9', tenant_id: T, customer_id: 'c1', round_id: 'r-mon', status: 'active' });
    db.rows('rounds').find((r) => r.id === 'r-mon')!.usual_lead_worker_id = 'w-lee';
    expect(await leadForCustomer(db.client, T, 'c1')).toBeNull(); // two different leads
    expect(await leadForCustomer(db.client, T, 'nobody')).toBeNull();
  });

  it('setUsualLead points the round’s future open visits at the lead, sparing visits given away for a day', async () => {
    // r-tue starts with Dave; the owner gave one visit to Lee for the day, and one is already finished.
    db.rows('jobs').find((j) => j.id === 'j2')!.assigned_worker_id = 'w-lee';
    const r = await setUsualLead(db.client, { tenantId: T, roundId: 'r-tue', workerId: 'w-lee', today: TODAY });
    expect(r).toEqual({ success: true, repointed: 2 }); // j1 and j5; j2 is already Lee’s; j3 done; j6 past
    expect(assigned()).toMatchObject({ j1: 'w-lee', j2: 'w-lee', j3: 'w-dave', j5: 'w-lee', j6: 'w-dave', j4: 'w-dave' });
    expect(db.rows('rounds').find((x) => x.id === 'r-tue')!.usual_lead_worker_id).toBe('w-lee');
  });

  it('making the owner the lead stores null and brings the visits back to the owner', async () => {
    const r = await setUsualLead(db.client, { tenantId: T, roundId: 'r-tue', workerId: 'w-owner', today: TODAY });
    expect(r).toEqual({ success: true, repointed: 3 });
    expect(db.rows('rounds').find((x) => x.id === 'r-tue')!.usual_lead_worker_id).toBeNull();
    expect(assigned()).toMatchObject({ j1: 'w-owner', j2: 'w-owner', j5: 'w-owner', j4: 'w-dave' });
  });

  it('refuses a helper or removed lead as the lead, and an unknown round', async () => {
    expect(await setUsualLead(db.client, { tenantId: T, roundId: 'r-tue', workerId: 'w-gone' })).toEqual({ success: false, error: CANNOT_TAKE_VISITS });
    expect(await setUsualLead(db.client, { tenantId: T, roundId: 'nope', workerId: 'w-lee' })).toEqual({ success: false, error: 'That round doesn’t exist.' });
    expect(db.rows('rounds').find((x) => x.id === 'r-tue')!.usual_lead_worker_id).toBe('w-dave');
  });

  it('repointRoundVisits does nothing when the lead has not changed', async () => {
    expect(await repointRoundVisits(db.client, { tenantId: T, roundId: 'r-tue', previousLeadWorkerId: 'w-dave', today: TODAY })).toBe(0);
  });

  it('releaseVisitsToOwner gives a departed place’s visits with the old lead back to the owner', async () => {
    const n = await releaseVisitsToOwner(db.client, { tenantId: T, agreementIds: ['a2'], leadWorkerId: 'w-dave', today: TODAY });
    expect(n).toBe(1);
    expect(assigned().j2).toBe('w-owner');
    expect(await releaseVisitsToOwner(db.client, { tenantId: T, agreementIds: ['a2'], leadWorkerId: null })).toBe(0);
  });

  it('repointAgreementVisits moves one house’s upcoming visits from the old lead to the new one, not past or done ones', async () => {
    const n = await repointAgreementVisits(db.client, { tenantId: T, agreementId: 'a1', fromLeadWorkerId: 'w-dave', toLeadWorkerId: 'w-lee', today: TODAY });
    expect(n).toBe(2); // j1 and j5; j3 is done, j6 is in the past
    const a = assigned();
    expect(a.j1).toBe('w-lee');
    expect(a.j5).toBe('w-lee');
    expect(a.j3).toBe('w-dave');
    expect(a.j6).toBe('w-dave');
    expect(a.j2).toBe('w-dave'); // another house, untouched
  });

  it('repointAgreementVisits sends a house back to the owner when the new round has no lead, and does nothing when nothing changes', async () => {
    expect(await repointAgreementVisits(db.client, { tenantId: T, agreementId: 'a2', fromLeadWorkerId: 'w-dave', toLeadWorkerId: null, today: TODAY })).toBe(1);
    expect(assigned().j2).toBe('w-owner');
    expect(await repointAgreementVisits(db.client, { tenantId: T, agreementId: 'a1', fromLeadWorkerId: 'w-dave', toLeadWorkerId: 'w-dave', today: TODAY })).toBe(0);
  });
});
