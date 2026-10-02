import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildSetupRequestEmail } from '@/lib/emails/setup-request';

const ALREADY = "We're already working on your last request — we'll be in touch.";
const SEND_FAIL = "Couldn't send that. Try again.";

type Row = {
  id: string;
  tenant_id: string;
  status: string;
  created_at: string;
  note: string | null;
  file_paths: string[];
  emailed_at: string | null;
  requested_by_user_id: string | null;
};

const session = {
  tenantId: 'tenant-1' as string | null,
  hasRounds: true,
  userId: 'user-1' as string | null,
  admin: true,
};

const state = {
  rows: [] as Row[],
  seq: 1,
  countError: false,
  insertError: false,
  uploadFail: null as string | null,
  pathsError: false,
  emailOk: true,
  signError: false,
  uploads: [] as { path: string; contentType?: string }[],
  removes: [] as string[][],
  signedSeconds: [] as number[],
  sent: [] as Record<string, unknown>[],
  profile: {
    businessName: 'Bright Windows',
    fullName: 'Pat Smith',
    userEmail: 'pat@bright.example',
    loginEmail: 'login@bright.example',
    companyPhone: '07700900123',
    contactPhone: null as string | null,
  },
};

function matches(row: Row, eqs: Record<string, string>): boolean {
  return Object.entries(eqs).every(([key, value]) => String(row[key as keyof Row]) === value);
}

function setupTable() {
  return {
    select(_cols?: string, opts?: { head?: boolean }) {
      if (opts?.head) {
        const eqs: Record<string, string> = {};
        const gtes: Record<string, string> = {};
        const q = {
          eq(col: string, val: string) {
            eqs[col] = val;
            return q;
          },
          gte(col: string, val: string) {
            gtes[col] = val;
            return q;
          },
          then(resolve: (value: unknown) => unknown) {
            if (state.countError) {
              return Promise.resolve({ count: null, error: { message: 'db down' } }).then(resolve);
            }
            const count = state.rows.filter((row) => {
              if (!matches(row, eqs)) return false;
              return Object.entries(gtes).every(([key, value]) => String(row[key as keyof Row]) >= value);
            }).length;
            return Promise.resolve({ count, error: null }).then(resolve);
          },
        };
        return q;
      }
      return {
        eq() {
          return { maybeSingle: async () => ({ data: null, error: null }) };
        },
      };
    },
    insert(row: Partial<Row>) {
      const id = `req-${state.seq}`;
      const saved: Row = {
        id,
        tenant_id: String(row.tenant_id),
        status: String(row.status),
        created_at: new Date().toISOString(),
        note: row.note ?? null,
        file_paths: row.file_paths ?? [],
        emailed_at: null,
        requested_by_user_id: row.requested_by_user_id ?? null,
      };
      return {
        select() {
          return {
            single: async () => {
              if (state.insertError) return { data: null, error: { message: 'insert' } };
              state.seq += 1;
              state.rows.push(saved);
              return { data: { id }, error: null };
            },
          };
        },
      };
    },
    update(patch: Partial<Row>) {
      const eqs: Record<string, string> = {};
      const q = {
        eq(col: string, val: string) {
          eqs[col] = val;
          return q;
        },
        then(resolve: (value: unknown) => unknown) {
          if (state.pathsError && Object.hasOwn(patch, 'file_paths')) {
            return Promise.resolve({ error: { message: 'paths' } }).then(resolve);
          }
          const row = state.rows.find((item) => matches(item, eqs));
          if (row) Object.assign(row, patch);
          return Promise.resolve({ error: null }).then(resolve);
        },
      };
      return q;
    },
    delete() {
      const eqs: Record<string, string> = {};
      const q = {
        eq(col: string, val: string) {
          eqs[col] = val;
          return q;
        },
        then(resolve: (value: unknown) => unknown) {
          state.rows = state.rows.filter((row) => !matches(row, eqs));
          return Promise.resolve({ error: null }).then(resolve);
        },
      };
      return q;
    },
  };
}

function fromTable(table: string) {
  if (table === 'users') {
    return {
      select() {
        return {
          eq() {
            return {
              maybeSingle: async () => ({
                data: { full_name: state.profile.fullName, email: state.profile.userEmail },
                error: null,
              }),
            };
          },
        };
      },
    };
  }
  if (table === 'tenants') {
    return {
      select() {
        return {
          eq() {
            return {
              maybeSingle: async () => ({
                data: {
                  name: state.profile.businessName,
                  settings: {
                    company: { phone: state.profile.companyPhone },
                    messaging: { contact_phone: state.profile.contactPhone },
                  },
                },
                error: null,
              }),
            };
          },
        };
      },
    };
  }
  return setupTable();
}

vi.mock('@/lib/data/tenant', () => ({ getTenantIdForCurrentUser: async () => session.tenantId }));
vi.mock('@/lib/data/tenant-products', () => ({ getTenantProducts: async () => ({ hasRounds: session.hasRounds }) }));
vi.mock('@/lib/stripe/connect', () => ({ isTenantAdmin: async () => session.admin }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: {
          user: session.userId ? { id: session.userId, email: state.profile.loginEmail } : null,
        },
      }),
    },
  }),
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => fromTable(table),
    storage: {
      from: () => ({
        upload: async (path: string, _body: unknown, opts?: { contentType?: string }) => {
          if (state.uploadFail && path.endsWith(state.uploadFail)) {
            return { error: { message: 'upload' } };
          }
          state.uploads.push({ path, contentType: opts?.contentType });
          return { error: null };
        },
        remove: async (paths: string[]) => {
          state.removes.push(paths);
          return { error: null };
        },
        createSignedUrl: async (path: string, seconds: number) => {
          state.signedSeconds.push(seconds);
          if (state.signError) return { data: null, error: { message: 'sign' } };
          return { data: { signedUrl: `https://files.example/${path}` }, error: null };
        },
      }),
    },
  }),
}));
vi.mock('@/lib/resend', () => ({
  FROM_EMAIL: 'noreply@joinworkwise.com',
  resend: {
    emails: {
      send: async (payload: Record<string, unknown>) => {
        state.sent.push(payload);
        return state.emailOk ? { error: null } : { error: { name: 'ResendError' } };
      },
    },
  },
}));

import { sendSetupRequest } from '@/lib/actions/rounds/setup-request';

function csv(name: string, text = 'hello') {
  return new File([text], name, { type: 'text/csv' });
}

function form(note: string, files: File[] = [], context: string | null = 'review') {
  const fd = new FormData();
  fd.set('note', note);
  if (context != null) fd.set('context', context);
  for (const file of files) fd.append('file', file);
  return fd;
}

function openRow(overrides: Partial<Row> = {}): Row {
  return {
    id: 'existing',
    tenant_id: 'tenant-1',
    status: 'open',
    created_at: new Date().toISOString(),
    note: null,
    file_paths: [],
    emailed_at: null,
    requested_by_user_id: 'user-1',
    ...overrides,
  };
}

beforeEach(() => {
  session.tenantId = 'tenant-1';
  session.hasRounds = true;
  session.userId = 'user-1';
  session.admin = true;
  state.rows = [];
  state.seq = 1;
  state.countError = false;
  state.insertError = false;
  state.uploadFail = null;
  state.pathsError = false;
  state.emailOk = true;
  state.signError = false;
  state.uploads = [];
  state.removes = [];
  state.signedSeconds = [];
  state.sent = [];
  state.profile.contactPhone = null;
  process.env.SETUP_REQUEST_EMAIL = 'owner@workwise.test';
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('sendSetupRequest', () => {
  it('only the account owner of a Rounds business can send one', async () => {
    session.admin = false;
    expect(await sendSetupRequest(form('help'))).toEqual({
      success: false,
      error: 'Only the account owner can do this.',
    });

    session.admin = true;
    session.hasRounds = false;
    expect(await sendSetupRequest(form('help'))).toEqual({
      success: false,
      error: 'Import is part of Rounds.',
    });

    session.hasRounds = true;
    session.tenantId = null;
    expect(await sendSetupRequest(form('help'))).toEqual({ success: false, error: 'Not signed in' });
    expect(state.rows).toHaveLength(0);
    expect(state.sent).toHaveLength(0);
  });

  it('asks for a file or a note, and refuses a bad file before saving anything', async () => {
    expect(await sendSetupRequest(form('   '))).toEqual({
      success: false,
      error: 'Add a file or tell us what you need.',
    });
    expect(await sendSetupRequest(form('x'.repeat(2001)))).toEqual({
      success: false,
      error: 'Keep the note to 2000 characters.',
    });
    expect(await sendSetupRequest(form('help', [], null))).toEqual({ success: false, error: SEND_FAIL });
    expect(await sendSetupRequest(form('help', [csv('notes.exe')]))).toEqual({
      success: false,
      error: 'notes.exe needs to be a spreadsheet, PDF, photo or text file.',
    });
    const big = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'big.csv', { type: 'text/csv' });
    expect(await sendSetupRequest(form('', [big]))).toEqual({
      success: false,
      error: 'big.csv is over 10 MB.',
    });
    expect(state.rows).toHaveLength(0);
  });

  it('blocks a second open request from the last 30 days and ignores other businesses', async () => {
    state.rows = [openRow()];
    expect(await sendSetupRequest(form('again'))).toEqual({ success: false, error: ALREADY });
    expect(state.sent).toHaveLength(0);
    expect(state.rows).toHaveLength(1);

    state.rows = [openRow({ tenant_id: 'someone-else' })];
    expect((await sendSetupRequest(form('ours'))).success).toBe(true);

    state.rows = [openRow({ status: 'done' })];
    state.sent = [];
    expect((await sendSetupRequest(form('after they closed it'))).success).toBe(true);

    state.rows = [openRow({ created_at: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString() })];
    state.sent = [];
    expect((await sendSetupRequest(form('a month later'))).success).toBe(true);
  });

  it('refuses when the existing-request count fails, and does not save a row', async () => {
    state.countError = true;
    expect(await sendSetupRequest(form('help'))).toEqual({ success: false, error: SEND_FAIL });
    expect(state.rows).toHaveLength(0);
    expect(state.sent).toHaveLength(0);
    expect(console.error).toHaveBeenCalledWith('[sendSetupRequest] could not check existing requests');
  });

  it('refuses when SETUP_REQUEST_EMAIL is missing, and logs that it is not set', async () => {
    delete process.env.SETUP_REQUEST_EMAIL;
    expect(await sendSetupRequest(form('help'))).toEqual({ success: false, error: SEND_FAIL });
    expect(state.rows).toHaveLength(0);
    expect(console.error).toHaveBeenCalledWith('SETUP_REQUEST_EMAIL not set');
  });

  it('saves the request, stores a safe name, and emails 7-day links to the owner', async () => {
    const result = await sendSetupRequest(
      form('Tuesday looks wrong', [csv('My Round (1).csv'), csv('My Round (1).csv', 'second')], 'read_failed'),
    );
    expect(result).toEqual({ success: true });
    expect(state.uploads.map((upload) => upload.path)).toEqual([
      'tenant-1/req-1/MyRound1.csv',
      'tenant-1/req-1/MyRound1-2.csv',
    ]);
    expect(state.uploads[0]?.contentType).toBe('text/csv');
    expect(state.uploads[0]?.path.length).toBeLessThanOrEqual('tenant-1/req-1/'.length + 80);
    expect(state.signedSeconds).toEqual([7 * 24 * 60 * 60, 7 * 24 * 60 * 60]);
    expect(state.rows).toHaveLength(1);
    expect(state.rows[0]).toMatchObject({
      tenant_id: 'tenant-1',
      requested_by_user_id: 'user-1',
      status: 'open',
      note: 'Tuesday looks wrong',
      file_paths: ['tenant-1/req-1/MyRound1.csv', 'tenant-1/req-1/MyRound1-2.csv'],
    });
    expect(state.rows[0]?.emailed_at).toEqual(expect.any(String));

    const payload = state.sent[0];
    expect(payload).toMatchObject({
      from: 'noreply@joinworkwise.com',
      to: 'owner@workwise.test',
      replyTo: 'login@bright.example',
      subject: 'Set-up request: Bright Windows',
    });
    expect(payload).not.toHaveProperty('attachments');
    const text = String(payload?.text);
    expect(text).toContain('Tenant: tenant-1');
    expect(text).toContain('Name: Pat Smith');
    expect(text).toContain('Email: login@bright.example');
    expect(text).toContain('Phone: 07700900123');
    expect(text).toContain("Where they got stuck: a file that couldn't be read");
    expect(text).toContain('Tuesday looks wrong');
    expect(text).toContain('https://files.example/tenant-1/req-1/MyRound1.csv');
    expect(text).toContain('7 days');
    expect(String(payload?.html)).not.toContain('<script>');

    expect(await sendSetupRequest(form('again'))).toEqual({ success: false, error: ALREADY });
  });

  it('uses the business contact number when one is set', async () => {
    state.profile.contactPhone = '+447700900999';
    await sendSetupRequest(form('help'));
    expect(String(state.sent[0]?.text)).toContain('Phone: +447700900999');
  });

  it('deletes the uploaded files and the row when an upload fails', async () => {
    state.uploadFail = 'bad.csv';
    const result = await sendSetupRequest(form('', [csv('ok.csv'), csv('bad.csv')]));
    expect(result).toEqual({ success: false, error: "Couldn't upload bad.csv. Try again." });
    expect(state.uploads.map((upload) => upload.path)).toEqual(['tenant-1/req-1/ok.csv']);
    expect(state.removes).toEqual([['tenant-1/req-1/ok.csv']]);
    expect(state.rows).toHaveLength(0);
    expect(state.sent).toHaveLength(0);
  });

  it('deletes the uploaded files and the row when the email fails', async () => {
    state.emailOk = false;
    const result = await sendSetupRequest(form('help', [csv('round.csv')]));
    expect(result).toEqual({ success: false, error: SEND_FAIL });
    expect(state.removes).toEqual([['tenant-1/req-1/round.csv']]);
    expect(state.rows).toHaveLength(0);
    expect(state.sent).toHaveLength(1);
  });

  it('deletes the row when the file list cannot be saved, so the 30-day rule does not stick', async () => {
    state.pathsError = true;
    expect(await sendSetupRequest(form('', [csv('round.csv')]))).toEqual({ success: false, error: SEND_FAIL });
    expect(state.removes).toEqual([['tenant-1/req-1/round.csv']]);
    expect(state.rows).toHaveLength(0);
    expect(state.sent).toHaveLength(0);
  });
});

describe('buildSetupRequestEmail', () => {
  it('escapes the note and only links https files', () => {
    const built = buildSetupRequestEmail({
      businessName: 'Bright & Co',
      tenantId: 'tenant-1',
      traderName: 'Pat',
      traderEmail: 'pat@bright.example',
      traderPhone: null,
      note: '<script>alert(1)</script>',
      context: 'done',
      files: [{ name: 'round.csv', bytes: 5, url: 'https://files.example/round.csv' }],
    });
    expect(built.subject).toBe('Set-up request: Bright & Co');
    expect(built.html).toContain('&lt;script&gt;');
    expect(built.html).not.toContain('<script>');
    expect(built.html).toContain('href="https://files.example/round.csv"');
    expect(built.text).toContain('after an import');
    expect(built.text).toContain('Phone: not on file');
  });
});
