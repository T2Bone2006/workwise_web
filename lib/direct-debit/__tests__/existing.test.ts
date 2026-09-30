import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  ignoreExistingMandate,
  linkExistingMandate,
  otherAppCollections,
  refreshMandateLinks,
  unlinkExistingMandate,
} from '@/lib/direct-debit/existing';
import { encryptToken } from '@/lib/gocardless/crypto';

const TENANT = '11111111-1111-1111-1111-111111111111';
const USER = '77777777-7777-7777-7777-777777777777';
const OUR_COLLECTION = '99999999-9999-4999-8999-999999999999';

type Row = Record<string, unknown>;
type Db = Record<string, Row[]>;

type Filter =
  | { kind: 'eq'; col: string; val: unknown }
  | { kind: 'in'; col: string; vals: unknown[] }
  | { kind: 'notnull'; col: string };

function matches(row: Row, filters: Filter[]): boolean {
  return filters.every((f) => {
    if (f.kind === 'eq') return row[f.col] === f.val;
    if (f.kind === 'in') return f.vals.includes(row[f.col]);
    return row[f.col] != null;
  });
}

let nextId = 1;

/** A small in-memory stand-in for the admin client (enough for existing.ts + connection.ts). */
function fakeAdmin(db: Db): SupabaseClient {
  const from = (table: string) => {
    db[table] ??= [];
    const rows = db[table];
    let op: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select';
    let payload: Row | Row[] = {};
    let onConflict: string[] = [];
    let columns = '';
    const filters: Filter[] = [];

    const uniqueViolation = (row: Row): boolean => {
      if (table !== 'customer_direct_debits') return false;
      return rows.some(
        (r) =>
          r !== row &&
          ((row.gocardless_mandate_id != null && r.gocardless_mandate_id === row.gocardless_mandate_id) ||
            (r.customer_id === row.customer_id &&
              ['pending', 'active'].includes(String(r.status)) &&
              ['pending', 'active'].includes(String(row.status)))),
      );
    };

    const pick = (r: Row): Row => {
      if (!columns || columns === '*') return { ...r };
      const out: Row = {};
      for (const c of columns.split(',').map((x) => x.trim()).filter(Boolean)) {
        const embed = /^(\w+)\((.*)\)$/.exec(c);
        if (embed) out[embed[1]] = r[embed[1]] ?? [];
        else out[c] = r[c];
      }
      return out;
    };

    const finish = async (single: boolean) => {
      if (op === 'insert') {
        const row: Row = { id: `id-${nextId++}`, ...(payload as Row) };
        if (uniqueViolation(row)) return { data: null, error: { code: '23505', message: 'duplicate' } };
        rows.push(row);
        return { data: single ? pick(row) : [pick(row)], error: null };
      }
      if (op === 'upsert') {
        for (const incoming of payload as Row[]) {
          const existing = rows.find((r) => onConflict.every((k) => r[k] === incoming[k]));
          if (existing) Object.assign(existing, incoming);
          else
            rows.push({
              id: `id-${nextId++}`,
              decision: 'pending',
              match_kind: 'none',
              linked_customer_id: null,
              direct_debit_id: null,
              ...incoming,
            });
        }
        return { data: null, error: null };
      }
      const hit = rows.filter((r) => matches(r, filters));
      if (op === 'update') for (const r of hit) Object.assign(r, payload);
      if (op === 'delete') {
        for (const r of hit) rows.splice(rows.indexOf(r), 1);
        // ON DELETE SET NULL from gocardless_mandate_links.direct_debit_id
        if (table === 'customer_direct_debits') {
          for (const link of db.gocardless_mandate_links ?? []) {
            if (hit.some((r) => r.id === link.direct_debit_id)) link.direct_debit_id = null;
          }
        }
      }
      const data = columns ? hit.map(pick) : null;
      return { data: single ? (data?.[0] ?? null) : data, error: null };
    };

    const builder = {
      select(cols = '*') {
        columns = cols;
        return builder;
      },
      insert(row: Row) {
        op = 'insert';
        payload = row;
        return builder;
      },
      upsert(list: Row[], opts: { onConflict: string }) {
        op = 'upsert';
        payload = list;
        onConflict = opts.onConflict.split(',');
        return builder;
      },
      update(row: Row) {
        op = 'update';
        payload = row;
        return builder;
      },
      delete() {
        op = 'delete';
        return builder;
      },
      eq(col: string, val: unknown) {
        filters.push({ kind: 'eq', col, val });
        return builder;
      },
      in(col: string, vals: unknown[]) {
        filters.push({ kind: 'in', col, vals });
        return builder;
      },
      not(col: string) {
        filters.push({ kind: 'notnull', col });
        return builder;
      },
      limit() {
        return builder;
      },
      maybeSingle() {
        return finish(true);
      },
      then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
        return finish(false).then(resolve, reject);
      },
    };
    return builder;
  };
  return { from } as unknown as SupabaseClient;
}

type Gc = {
  mandates: Row[];
  customers: Row[];
  customer_bank_accounts: Row[];
  subscriptions: Row[];
  payments: Row[];
};

const fetchMock = vi.fn<typeof fetch>();

function gocardless(gc: Gc) {
  fetchMock.mockImplementation(async (input) => {
    const url = new URL(String(input));
    const q = url.searchParams;
    const path = url.pathname;
    const single = /^\/mandates\/(\w+)$/.exec(path);
    if (single) {
      const mandate = gc.mandates.find((m) => m.id === single[1]);
      return mandate
        ? new Response(JSON.stringify({ mandates: mandate }), { status: 200 })
        : new Response(JSON.stringify({ error: { message: 'Not found', code: 404 } }), { status: 404 });
    }
    const key = path.slice(1) as keyof Gc;
    let list = gc[key] ?? [];
    if (q.get('status')) list = list.filter((r) => r.status === q.get('status'));
    if (q.get('mandate')) list = list.filter((r) => (r.links as Row | undefined)?.mandate === q.get('mandate'));
    return new Response(JSON.stringify({ [key]: list, meta: { cursors: { after: null } } }), {
      status: 200,
    });
  });
}

let tokenKey: Buffer;

function baseDb(): Db {
  return {
    gocardless_connections: [
      {
        id: 'conn',
        tenant_id: TENANT,
        status: 'connected',
        organisation_id: 'OR1',
        access_token_enc: encryptToken('sandbox_token', tokenKey),
        verification_status: 'successful',
        mandates_checked_at: null,
      },
    ],
    customers: [
      {
        id: 'cust-jane',
        tenant_id: TENANT,
        name: 'Mrs Jane Wright',
        email: 'jane@example.com',
        is_active: true,
        billing_address: '1 High St, LS1 4AB',
        service_agreements: [],
      },
      {
        id: 'cust-bob',
        tenant_id: TENANT,
        name: 'Bob Green',
        email: null,
        is_active: true,
        billing_address: null,
        service_agreements: [{ postcode: 'LS2 9ZZ' }],
      },
      {
        id: 'cust-amy',
        tenant_id: TENANT,
        name: 'Amy Hall',
        email: 'amy@example.com',
        is_active: true,
        billing_address: null,
        service_agreements: [],
      },
    ],
    customer_direct_debits: [],
    direct_debit_collections: [{ id: OUR_COLLECTION, tenant_id: TENANT }],
    gocardless_mandate_links: [],
  };
}

function mandate(id: string, customer: string, extra: Row = {}): Row {
  return {
    id,
    status: 'active',
    reference: `REF-${id}`,
    created_at: '2025-01-01T00:00:00Z',
    next_possible_charge_date: '2026-10-05',
    metadata: {},
    links: { customer, customer_bank_account: `BA-${customer}` },
    ...extra,
  };
}

function baseGc(): Gc {
  return {
    mandates: [
      mandate('MD_JANE', 'CU_JANE'),
      mandate('MD_BOB', 'CU_BOB', { status: 'submitted' }),
      mandate('MD_AMY', 'CU_AMY'),
      mandate('MD_NOBODY', 'CU_NOBODY'),
      mandate('MD_OURS', 'CU_OURS', { metadata: { workwise_tenant_id: TENANT } }),
      mandate('MD_DEAD', 'CU_DEAD', { status: 'cancelled' }),
    ],
    customers: [
      { id: 'CU_JANE', email: 'Jane@Example.com', given_name: 'Jane', family_name: 'Wright', postal_code: 'LS1 4AB' },
      { id: 'CU_BOB', email: 'bob.other@example.com', given_name: 'Bob', family_name: 'Green', postal_code: 'ls29zz' },
      { id: 'CU_AMY', email: 'amy@example.com', given_name: 'Amy', family_name: 'Hall', postal_code: null },
      { id: 'CU_NOBODY', email: 'x@example.com', company_name: 'Acme Ltd', postal_code: 'M1 1AA' },
      { id: 'CU_OURS', email: 'ours@example.com' },
      { id: 'CU_DEAD', email: 'dead@example.com' },
    ],
    customer_bank_accounts: ['JANE', 'BOB', 'AMY', 'NOBODY', 'OURS', 'DEAD'].map((n) => ({
      id: `BA-CU_${n}`,
      bank_name: 'BARCLAYS BANK PLC',
      account_number_ending: '11',
    })),
    subscriptions: [],
    payments: [
      // Amy's old app still has a collection waiting.
      { id: 'PM_OLD', status: 'pending_submission', metadata: {}, links: { mandate: 'MD_AMY' } },
      // Ours on Jane's mandate — never counts as another app.
      {
        id: 'PM_OURS',
        status: 'submitted',
        metadata: { workwise_collection_id: OUR_COLLECTION },
        links: { mandate: 'MD_JANE' },
      },
      // Already paid out — not waiting.
      { id: 'PM_DONE', status: 'paid_out', metadata: {}, links: { mandate: 'MD_JANE' } },
    ],
  };
}

beforeEach(() => {
  tokenKey = randomBytes(32);
  process.env.GOCARDLESS_ENVIRONMENT = 'sandbox';
  process.env.GOCARDLESS_CLIENT_ID = 'client-id';
  process.env.GOCARDLESS_CLIENT_SECRET = 'client-secret';
  process.env.GOCARDLESS_WEBHOOK_SECRET = 'webhook-secret';
  process.env.GOCARDLESS_TOKEN_KEY = tokenKey.toString('base64');
  process.env.GOCARDLESS_REDIRECT_URI = 'https://example.test/api/gocardless/callback';
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const now = new Date('2026-09-30T12:00:00.000Z');
const link = (db: Db, mandateId: string) =>
  db.gocardless_mandate_links.find((r) => r.gocardless_mandate_id === mandateId)!;

describe('refreshMandateLinks', () => {
  it('stores, matches and auto-links; skips ours, dead and already-linked mandates', async () => {
    const db = baseDb();
    db.customer_direct_debits.push({
      id: 'dd-existing',
      tenant_id: TENANT,
      customer_id: 'someone',
      gocardless_mandate_id: 'MD_KNOWN',
      status: 'active',
    });
    const gc = baseGc();
    gc.mandates.push(mandate('MD_KNOWN', 'CU_JANE'));
    gocardless(gc);

    const summary = await refreshMandateLinks(fakeAdmin(db), TENANT, now);
    expect(summary).toEqual({ found: 4, autoLinked: 1, probable: 2, unmatched: 1, otherApp: 1 });

    const ids = db.gocardless_mandate_links.map((r) => r.gocardless_mandate_id).sort();
    expect(ids).toEqual(['MD_AMY', 'MD_BOB', 'MD_JANE', 'MD_NOBODY']);

    // Jane: same email, our own payment doesn't count → linked automatically.
    expect(link(db, 'MD_JANE')).toMatchObject({
      match_kind: 'email',
      decision: 'linked',
      linked_customer_id: 'cust-jane',
      other_collections: 0,
      payer_name: 'Jane Wright',
      bank_name: 'BARCLAYS BANK PLC',
      account_number_ending: '11',
      decided_by_user_id: null,
    });
    const janeDd = db.customer_direct_debits.find((r) => r.gocardless_mandate_id === 'MD_JANE');
    expect(janeDd).toMatchObject({
      customer_id: 'cust-jane',
      source: 'imported',
      status: 'active',
      gocardless_organisation_id: 'OR1',
      mandate_reference: 'REF-MD_JANE',
      other_collections_confirmed_at: null,
    });

    // Bob: name + postcode → probable, never automatic.
    expect(link(db, 'MD_BOB')).toMatchObject({
      match_kind: 'name_postcode',
      suggested_customer_id: 'cust-bob',
      decision: 'pending',
    });

    // Amy: email matches but her old app is still collecting → waits for the tick.
    expect(link(db, 'MD_AMY')).toMatchObject({
      match_kind: 'email',
      suggested_customer_id: 'cust-amy',
      decision: 'pending',
      other_collections: 1,
      other_collections_detail: '1 collection waiting',
    });

    expect(link(db, 'MD_NOBODY')).toMatchObject({ match_kind: 'none', decision: 'pending' });
    expect(db.gocardless_connections[0].mandates_checked_at).toBe(now.toISOString());
  });

  it('running twice gives the same rows and never changes a decision', async () => {
    const db = baseDb();
    gocardless(baseGc());
    const admin = fakeAdmin(db);
    await refreshMandateLinks(admin, TENANT, now);
    await ignoreExistingMandate(admin, { tenantId: TENANT, userId: USER, linkId: String(link(db, 'MD_NOBODY').id) });
    const before = db.gocardless_mandate_links.length;

    const second = await refreshMandateLinks(admin, TENANT, now);
    expect(db.gocardless_mandate_links).toHaveLength(before);
    expect(db.customer_direct_debits).toHaveLength(1);
    expect(link(db, 'MD_NOBODY').decision).toBe('ignored');
    expect(link(db, 'MD_JANE').decision).toBe('linked');
    // Jane is now a known mandate, so she's no longer "found".
    expect(second.found).toBe(3);
  });

  it('not connected → zeros, no GoCardless call', async () => {
    const db = baseDb();
    db.gocardless_connections[0].status = 'disconnected';
    const summary = await refreshMandateLinks(fakeAdmin(db), TENANT, now);
    expect(summary).toEqual({ found: 0, autoLinked: 0, probable: 0, unmatched: 0, otherApp: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('GoCardless unreachable → throws, nothing written', async () => {
    const db = baseDb();
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    await expect(refreshMandateLinks(fakeAdmin(db), TENANT, now)).rejects.toThrow();
    expect(db.gocardless_mandate_links).toHaveLength(0);
  });
});

describe('linkExistingMandate', () => {
  async function refreshed() {
    const db = baseDb();
    gocardless(baseGc());
    const admin = fakeAdmin(db);
    await refreshMandateLinks(admin, TENANT, now);
    return { db, admin };
  }

  it('needs the tick when another app is collecting', async () => {
    const { db, admin } = await refreshed();
    const linkId = String(link(db, 'MD_AMY').id);
    const refused = await linkExistingMandate(admin, {
      tenantId: TENANT,
      userId: USER,
      linkId,
      customerId: 'cust-amy',
      confirmStoppedOldApp: false,
    });
    expect(refused).toEqual({
      ok: false,
      error:
        'Another app is still collecting from this Direct Debit. Stop it in your old app first, then tick the box.',
    });

    const linked = await linkExistingMandate(admin, {
      tenantId: TENANT,
      userId: USER,
      linkId,
      customerId: 'cust-amy',
      confirmStoppedOldApp: true,
    });
    expect(linked.ok).toBe(true);
    const dd = db.customer_direct_debits.find((r) => r.gocardless_mandate_id === 'MD_AMY');
    expect(dd?.other_collections_confirmed_at).toEqual(expect.any(String));
    expect(link(db, 'MD_AMY')).toMatchObject({ decision: 'linked', decided_by_user_id: USER });
  });

  it('a submitted mandate links as pending', async () => {
    const { db, admin } = await refreshed();
    const result = await linkExistingMandate(admin, {
      tenantId: TENANT,
      userId: USER,
      linkId: String(link(db, 'MD_BOB').id),
      customerId: 'cust-bob',
      confirmStoppedOldApp: false,
    });
    expect(result.ok).toBe(true);
    expect(db.customer_direct_debits.find((r) => r.gocardless_mandate_id === 'MD_BOB')).toMatchObject({
      status: 'pending',
      activated_at: null,
    });
  });

  it('refuses one already dealt with, and a customer who already has a Direct Debit', async () => {
    const { db, admin } = await refreshed();
    expect(
      await linkExistingMandate(admin, {
        tenantId: TENANT,
        userId: USER,
        linkId: String(link(db, 'MD_JANE').id),
        customerId: 'cust-jane',
        confirmStoppedOldApp: false,
      }),
    ).toEqual({ ok: false, error: 'This one has already been dealt with.' });

    expect(
      await linkExistingMandate(admin, {
        tenantId: TENANT,
        userId: USER,
        linkId: String(link(db, 'MD_NOBODY').id),
        customerId: 'cust-jane',
        confirmStoppedOldApp: false,
      }),
    ).toEqual({ ok: false, error: 'Mrs Jane Wright already has a Direct Debit.' });
  });

  it('a mandate cancelled in GoCardless since → refused, status updated', async () => {
    const { db, admin } = await refreshed();
    const gc = baseGc();
    gc.mandates = gc.mandates.map((m) => (m.id === 'MD_NOBODY' ? { ...m, status: 'cancelled' } : m));
    gocardless(gc);
    const result = await linkExistingMandate(admin, {
      tenantId: TENANT,
      userId: USER,
      linkId: String(link(db, 'MD_NOBODY').id),
      customerId: 'cust-bob',
      confirmStoppedOldApp: false,
    });
    expect(result).toEqual({ ok: false, error: 'This Direct Debit is no longer active in GoCardless.' });
    expect(link(db, 'MD_NOBODY').mandate_status).toBe('cancelled');
    expect(db.customer_direct_debits.some((r) => r.gocardless_mandate_id === 'MD_NOBODY')).toBe(false);
  });

  it('if someone else decides at the same moment, the new Direct Debit is removed again', async () => {
    const { db } = await refreshed();
    const base = fakeAdmin(db);
    const nobody = link(db, 'MD_NOBODY');
    // Another session ignores it right after our insert.
    const racing = {
      from(table: string) {
        const b = base.from(table) as unknown as Record<string, (...a: unknown[]) => unknown>;
        if (table === 'customer_direct_debits') {
          const insert = b.insert.bind(b);
          b.insert = (row: unknown) => {
            nobody.decision = 'ignored';
            return insert(row);
          };
        }
        return b;
      },
    } as unknown as SupabaseClient;
    const result = await linkExistingMandate(racing, {
      tenantId: TENANT,
      userId: USER,
      linkId: String(nobody.id),
      customerId: 'cust-bob',
      confirmStoppedOldApp: false,
    });
    expect(result).toEqual({ ok: false, error: 'This one has already been dealt with.' });
    expect(db.customer_direct_debits.some((r) => r.gocardless_mandate_id === 'MD_NOBODY')).toBe(false);
  });
});

describe('unlinkExistingMandate / ignoreExistingMandate', () => {
  it('undoes a link with no collections and an ignore; refuses once collected', async () => {
    const db = baseDb();
    gocardless(baseGc());
    const admin = fakeAdmin(db);
    await refreshMandateLinks(admin, TENANT, now);

    const jane = link(db, 'MD_JANE');
    const ddId = jane.direct_debit_id;
    db.direct_debit_collections.push({ id: 'col-1', tenant_id: TENANT, direct_debit_id: ddId });
    expect(await unlinkExistingMandate(admin, { tenantId: TENANT, userId: USER, linkId: String(jane.id) })).toEqual({
      ok: false,
      error: 'Collections have been made on this Direct Debit — cancel it on the customer instead.',
    });

    db.direct_debit_collections = db.direct_debit_collections.filter((r) => r.id !== 'col-1');
    expect(await unlinkExistingMandate(admin, { tenantId: TENANT, userId: USER, linkId: String(jane.id) })).toEqual({
      ok: true,
    });
    expect(jane).toMatchObject({ decision: 'pending', linked_customer_id: null, direct_debit_id: null });
    expect(db.customer_direct_debits.some((r) => r.id === ddId)).toBe(false);

    const nobody = link(db, 'MD_NOBODY');
    expect(await ignoreExistingMandate(admin, { tenantId: TENANT, userId: USER, linkId: String(nobody.id) })).toEqual({
      ok: true,
    });
    expect(await ignoreExistingMandate(admin, { tenantId: TENANT, userId: USER, linkId: String(nobody.id) })).toEqual({
      ok: false,
      error: 'This one has already been dealt with.',
    });
    expect(await unlinkExistingMandate(admin, { tenantId: TENANT, userId: USER, linkId: String(nobody.id) })).toEqual({
      ok: true,
    });
    expect(nobody.decision).toBe('pending');
  });
});

describe('otherAppCollections', () => {
  it('counts foreign waiting payments and active subscriptions, not ours', async () => {
    const db = baseDb();
    const gc = baseGc();
    gc.subscriptions.push(
      { id: 'SB_OLD', status: 'active', metadata: {}, links: { mandate: 'MD_JANE' } },
      { id: 'SB_GONE', status: 'cancelled', metadata: {}, links: { mandate: 'MD_JANE' } },
    );
    gc.payments.push(
      { id: 'PM_OLD2', status: 'pending_submission', metadata: {}, links: { mandate: 'MD_JANE' } },
      { id: 'PM_OLD3', status: 'submitted', metadata: { workwise_collection_id: 'not-ours' }, links: { mandate: 'MD_JANE' } },
    );
    gocardless(gc);
    expect(await otherAppCollections(fakeAdmin(db), { tenantId: TENANT, mandateId: 'MD_JANE' })).toEqual({
      count: 3,
      detail: '1 subscription, 2 collections waiting',
    });
  });

  it('nothing foreign → 0', async () => {
    const db = baseDb();
    gocardless(baseGc());
    expect(await otherAppCollections(fakeAdmin(db), { tenantId: TENANT, mandateId: 'MD_BOB' })).toEqual({
      count: 0,
      detail: '',
    });
  });

  it('GoCardless unreachable → error', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    expect(await otherAppCollections(fakeAdmin(baseDb()), { tenantId: TENANT, mandateId: 'MD_JANE' })).toEqual({
      error: "Couldn't reach GoCardless — try again.",
    });
    errorLog.mockRestore();
  });
});
