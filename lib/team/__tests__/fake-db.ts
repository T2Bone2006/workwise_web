/**
 * A tiny in-memory stand-in for the Supabase client, enough for the Phase 9 team cores: from(table) with
 * select / insert / update / delete / upsert, the filters those cores use, count/head, single/maybeSingle,
 * unique-constraint violations, rpc handlers and auth.admin. Not a database: no joins, no embedded selects.
 */
export type Row = Record<string, unknown>;

type Filter = (row: Row) => boolean;
type Result = { data: unknown; error: { code?: string; message: string } | null; count?: number | null };

export type FakeDbOptions = {
  /** table → list of column-lists that must be unique together (a clash gives error code 23505). */
  unique?: Record<string, string[][]>;
  /** table → fixed values added to every inserted row when the column is missing. */
  defaults?: Record<string, Row>;
};

let idCounter = 0;
export function fakeId(prefix = 'id'): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

function parseInList(list: string): string[] {
  return list
    .replace(/^\(/, '')
    .replace(/\)$/, '')
    .split(',')
    .map((s) => s.trim().replace(/^"|"$/g, ''))
    .filter((s) => s !== '');
}

class Query implements PromiseLike<Result> {
  private filters: Filter[] = [];
  private op: 'select' | 'insert' | 'update' | 'delete' | 'upsert' = 'select';
  private payload: Row | Row[] | null = null;
  private returning = false;
  private head = false;
  private wantCount = false;
  private orderBy: Array<{ col: string; asc: boolean }> = [];
  private max: number | null = null;
  private window: [number, number] | null = null;
  private one: 'single' | 'maybe' | null = null;
  private upsertIgnore = false;
  private upsertOn: string[] = [];

  constructor(
    private readonly db: FakeDb,
    private readonly table: string,
  ) {}

  select(_cols?: string, opts?: { count?: 'exact'; head?: boolean }): this {
    if (this.op === 'select') {
      this.head = Boolean(opts?.head);
      this.wantCount = opts?.count === 'exact';
    } else {
      this.returning = true;
    }
    return this;
  }
  insert(payload: Row | Row[]): this {
    this.op = 'insert';
    this.payload = payload;
    return this;
  }
  upsert(payload: Row | Row[], opts?: { onConflict?: string; ignoreDuplicates?: boolean }): this {
    this.op = 'upsert';
    this.payload = payload;
    this.upsertIgnore = Boolean(opts?.ignoreDuplicates);
    this.upsertOn = opts?.onConflict ? opts.onConflict.split(',').map((s) => s.trim()) : [];
    return this;
  }
  update(payload: Row): this {
    this.op = 'update';
    this.payload = payload;
    return this;
  }
  delete(): this {
    this.op = 'delete';
    return this;
  }
  eq(col: string, value: unknown): this {
    this.filters.push((r) => r[col] === value);
    return this;
  }
  neq(col: string, value: unknown): this {
    this.filters.push((r) => r[col] !== value);
    return this;
  }
  in(col: string, values: readonly unknown[]): this {
    this.filters.push((r) => values.includes(r[col]));
    return this;
  }
  is(col: string, value: unknown): this {
    this.filters.push((r) => (value === null ? r[col] == null : r[col] === value));
    return this;
  }
  not(col: string, operator: string, value: unknown): this {
    if (operator === 'in') {
      const list = Array.isArray(value) ? (value as unknown[]) : parseInList(String(value));
      this.filters.push((r) => !list.includes(r[col]));
    } else if (operator === 'is') {
      this.filters.push((r) => (value === null ? r[col] != null : r[col] !== value));
    } else if (operator === 'eq') {
      this.filters.push((r) => r[col] !== value);
    }
    return this;
  }
  /** PostgREST-style: 'a.is.null,b.not.is.null' (any term true). Supports eq, neq, is.null and not.is.null. */
  or(expression: string): this {
    const terms = expression.split(',').map((term) => {
      const [col, ...rest] = term.trim().split('.');
      const op = rest.join('.');
      return (r: Row): boolean => {
        if (op === 'is.null') return r[col] == null;
        if (op === 'not.is.null') return r[col] != null;
        if (op.startsWith('eq.')) return String(r[col]) === op.slice(3);
        if (op.startsWith('neq.')) return String(r[col]) !== op.slice(4);
        return false;
      };
    });
    this.filters.push((r) => terms.some((f) => f(r)));
    return this;
  }
  gte(col: string, value: unknown): this {
    this.filters.push((r) => r[col] != null && (r[col] as string | number) >= (value as string | number));
    return this;
  }
  gt(col: string, value: unknown): this {
    this.filters.push((r) => r[col] != null && (r[col] as string | number) > (value as string | number));
    return this;
  }
  lte(col: string, value: unknown): this {
    this.filters.push((r) => r[col] != null && (r[col] as string | number) <= (value as string | number));
    return this;
  }
  lt(col: string, value: unknown): this {
    this.filters.push((r) => r[col] != null && (r[col] as string | number) < (value as string | number));
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }): this {
    this.orderBy.push({ col, asc: opts?.ascending !== false });
    return this;
  }
  limit(n: number): this {
    this.max = n;
    return this;
  }
  range(from: number, to: number): this {
    this.window = [from, to];
    return this;
  }
  single(): this {
    this.one = 'single';
    return this;
  }
  maybeSingle(): this {
    this.one = 'maybe';
    return this;
  }
  returns<T>(): this & { _t?: T } {
    return this;
  }

  then<A = Result, B = never>(
    onfulfilled?: ((value: Result) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve(this.run()).then(onfulfilled, onrejected);
  }

  private shape(rows: Row[]): Result {
    const list = rows.map((r) => ({ ...r }));
    if (this.one) {
      if (list.length === 0) {
        return this.one === 'single'
          ? { data: null, error: { code: 'PGRST116', message: 'no rows' } }
          : { data: null, error: null };
      }
      return { data: list[0], error: null };
    }
    return { data: this.head ? null : list, error: null, count: this.wantCount ? list.length : null };
  }

  private violates(candidate: Row, existing: Row[]): boolean {
    const rules = this.db.options.unique?.[this.table] ?? [];
    return rules.some((cols) =>
      existing.some((r) => r !== candidate && cols.every((c) => r[c] != null && r[c] === candidate[c])),
    );
  }

  private run(): Result {
    const rows = this.db.rows(this.table);
    const matching = () => rows.filter((r) => this.filters.every((f) => f(r)));
    this.db.log.push({ table: this.table, op: this.op, payload: this.payload });

    if (this.op === 'select') {
      let out = matching();
      for (const { col, asc } of [...this.orderBy].reverse()) {
        out = [...out].sort((a, b) => {
          const av = a[col] as string | number | null;
          const bv = b[col] as string | number | null;
          if (av == null && bv == null) return 0;
          if (av == null) return asc ? 1 : -1;
          if (bv == null) return asc ? -1 : 1;
          return av < bv ? (asc ? -1 : 1) : av > bv ? (asc ? 1 : -1) : 0;
        });
      }
      if (this.window) out = out.slice(this.window[0], this.window[1] + 1);
      if (this.max != null) out = out.slice(0, this.max);
      return this.shape(out);
    }

    if (this.op === 'insert' || this.op === 'upsert') {
      const list = Array.isArray(this.payload) ? this.payload : [this.payload as Row];
      const created: Row[] = [];
      for (const raw of list) {
        const row: Row = { ...(this.db.options.defaults?.[this.table] ?? {}), ...raw };
        if (row.id === undefined) row.id = fakeId(this.table);
        if (this.op === 'upsert' && this.upsertOn.length > 0) {
          const dup = rows.find((r) => this.upsertOn.every((c) => r[c] === row[c] && r[c] != null));
          if (dup) {
            if (!this.upsertIgnore) Object.assign(dup, raw);
            continue;
          }
        }
        if (this.violates(row, rows)) {
          return { data: null, error: { code: '23505', message: `duplicate key value violates unique constraint on ${this.table}` } };
        }
        rows.push(row);
        created.push(row);
      }
      return this.returning || this.one ? this.shape(created) : { data: null, error: null };
    }

    if (this.op === 'update') {
      const hit = matching();
      for (const r of hit) {
        const next = { ...r, ...(this.payload as Row) };
        if (this.violates(next, rows.filter((x) => x !== r))) {
          return { data: null, error: { code: '23505', message: `duplicate key value violates unique constraint on ${this.table}` } };
        }
        Object.assign(r, this.payload as Row);
      }
      return this.returning || this.one ? this.shape(hit) : { data: null, error: null };
    }

    const gone = matching();
    this.db.tables[this.table] = rows.filter((r) => !gone.includes(r));
    return this.returning || this.one ? this.shape(gone) : { data: null, error: null };
  }
}

export class FakeDb {
  tables: Record<string, Row[]> = {};
  log: Array<{ table: string; op: string; payload: unknown }> = [];
  rpcHandlers: Record<string, (args: Row) => unknown> = {};
  rpcCalls: Array<{ name: string; args: Row }> = [];
  authBanCalls: Array<{ id: string; attrs: Record<string, unknown> }> = [];
  authBanError: { message: string } | null = null;

  constructor(
    seed: Record<string, Row[]> = {},
    readonly options: FakeDbOptions = {},
  ) {
    for (const [name, list] of Object.entries(seed)) this.tables[name] = list.map((r) => ({ ...r }));
  }

  rows(table: string): Row[] {
    if (!this.tables[table]) this.tables[table] = [];
    return this.tables[table];
  }

  from(table: string): Query {
    return new Query(this, table);
  }

  rpc(name: string, args: Row): PromiseLike<Result> {
    this.rpcCalls.push({ name, args });
    const handler = this.rpcHandlers[name];
    if (!handler) return Promise.resolve({ data: null, error: { message: `no rpc handler for ${name}` } });
    try {
      return Promise.resolve({ data: handler(args), error: null });
    } catch (err) {
      return Promise.resolve({ data: null, error: { message: err instanceof Error ? err.message : String(err) } });
    }
  }

  authInviteError: { message: string; code?: string } | null = null;
  authCreated: Array<{ id: string; email: string }> = [];
  authDeleted: string[] = [];

  auth = {
    admin: {
      updateUserById: async (id: string, attrs: Record<string, unknown>) => {
        this.authBanCalls.push({ id, attrs });
        return { data: null, error: this.authBanError };
      },
      generateLink: async (args: { email: string }) => {
        if (this.authInviteError) return { data: null, error: this.authInviteError };
        const id = fakeId('auth');
        this.authCreated.push({ id, email: args.email });
        return { data: { user: { id } }, error: null };
      },
      deleteUser: async (id: string) => {
        this.authDeleted.push(id);
        return { data: null, error: null };
      },
    },
  };

  /** Cast for the cores, which take a SupabaseClient. */
  get client(): never {
    return this as never;
  }
}

export function fakeDb(seed: Record<string, Row[]> = {}, options: FakeDbOptions = {}): FakeDb {
  return new FakeDb(seed, options);
}
