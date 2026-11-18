import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));

import {
  EXPORT_COLUMNS,
  buildSheetModel,
  exportKeysForTable,
  groupIdsForTable,
  parseCustomAmount,
  type ExportableRow,
} from '@/lib/jobs/export-columns';

function row(id: string, fields: Record<string, string>): ExportableRow {
  return {
    id,
    tenant_id: 't',
    customer_id: 'c1',
    assigned_worker_id: null,
    reference_number: `REF-${id}`,
    address: '1 High St',
    status: 'pending',
    priority: 'high',
    scheduled_date: '2026-11-20',
    scheduled_time: null,
    created_at: '2026-11-01T10:00:00Z',
    updated_at: null,
    customer_name: 'Acme',
    worker_name: null,
    required_skills: ['gas', 'electrics'],
    source_fields: fields,
    started_at: null,
    arrived_at: null,
    completed_at: null,
    completion_notes: null,
    status_set_at: null,
  };
}

const cols = (keys: string[]) => EXPORT_COLUMNS.filter((c) => keys.includes(c.key));
const warrant = { id: 'g1', name: 'Warrant Officer', aliases: ['W/O', 'B/R Name'] };

describe('export follows the table', () => {
  it('ticks the table columns plus reference and status-set-at', () => {
    const keys = exportKeysForTable(['customer', 'worker', 'status', 'fg:g1', 'sf:Foo']);
    expect([...keys].sort()).toEqual(
      ['customer_name', 'reference_number', 'status', 'status_set_at', 'worker_name'].sort(),
    );
  });

  it('ticks only the field groups the table shows', () => {
    const groups = [warrant, { id: 'g2', name: 'Site', aliases: ['Site'] }];
    expect([...groupIdsForTable(['status', 'fg:g1'], groups)]).toEqual(['g1']);
  });

  it('can export priority, skills and created, which the table can show', () => {
    const model = buildSheetModel([row('1', {})], cols(['priority', 'skills', 'created_at']), []);
    expect(model.headers).toEqual(['Priority', 'Skills', 'Created']);
    expect(model.records[0]).toMatchObject({ Priority: 'High', Skills: 'gas, electrics' });
  });
});

describe('field groups in the export', () => {
  it('writes a group as one column and leaves its raw headers out', () => {
    const rows = [row('1', { 'W/O': 'Sam', Other: 'x' }), row('2', { 'B/R Name': 'Priya', Other: 'y' })];
    const model = buildSheetModel(rows, cols(['reference_number']), [warrant]);
    expect(model.headers).toEqual(['Job Ref', 'Warrant Officer', 'Other']);
    expect(model.records.map((r) => r['Warrant Officer'])).toEqual(['Sam', 'Priya']);
  });

  it('keeps raw headers when the group is not ticked', () => {
    const model = buildSheetModel([row('1', { 'W/O': 'Sam' })], cols(['reference_number']), []);
    expect(model.headers).toEqual(['Job Ref', 'W/O']);
  });

  it('skips a group no job in the tab has a value for', () => {
    const model = buildSheetModel([row('1', { Other: 'x' })], cols(['reference_number']), [warrant]);
    expect(model.headers).toEqual(['Job Ref', 'Other']);
  });

  it('does not collide with a WorkWise column or a spreadsheet header of the same name', () => {
    const clash = { id: 'g3', name: 'Customer', aliases: ['Cust'] };
    const model = buildSheetModel([row('1', { Cust: 'Bob' })], cols(['customer_name']), [clash]);
    expect(model.headers).toEqual(['Customer', 'Field: Customer']);
    expect(model.records[0]).toEqual({ Customer: 'Acme', 'Field: Customer': 'Bob' });
  });
});

describe('custom amount', () => {
  it('accepts a whole number inside the limit', () => {
    expect(parseCustomAmount('25', 100)).toEqual({ ok: true, count: 25 });
  });
  it.each(['', '  ', '0', '-3', '2.5', 'abc', '101'])('refuses %j instead of exporting everything', (raw) => {
    const result = parseCustomAmount(raw, 100);
    expect(result.ok).toBe(false);
  });
  it('says what is allowed', () => {
    expect(parseCustomAmount('0', 1500)).toEqual({ ok: false, error: 'Enter a whole number from 1 to 1,500.' });
  });
});
