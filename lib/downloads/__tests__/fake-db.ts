import type { SupabaseClient } from '@supabase/supabase-js';

export type Row = Record<string, unknown>;
export type Query = { table: string; select: string; eq: Array<[string, unknown]> };

/**
 * An in-memory database that applies the filters it is given, records every
 * query, and serves storage downloads. Rows of another business therefore
 * never come back, and tests prove it by outcome.
 */
export function fakeDb(tables: Record<string, Row[]> = {}, opts: { files?: Record<string, Uint8Array>; failTable?: string } = {}) {
  const queries: Query[] = [];
  const db = {
    from(table: string) {
      const q: Query = { table, select: '', eq: [] };
      queries.push(q);
      const preds: Array<(r: Row) => boolean> = [];
      let head = false;
      let range: [number, number] | null = null;
      const b: Record<string, unknown> = {};
      b.select = (cols: string, o?: { head?: boolean }) => { q.select = cols; head = !!o?.head; return b; };
      b.eq = (k: string, v: unknown) => { q.eq.push([k, v]); preds.push((r) => r[k] === v); return b; };
      b.is = (k: string, v: unknown) => { preds.push((r) => (r[k] ?? null) === v); return b; };
      b.in = (k: string, vs: unknown[]) => { preds.push((r) => vs.includes(r[k])); return b; };
      b.gt = (k: string, v: number | string) => { preds.push((r) => (r[k] as number | string) > v); return b; };
      b.gte = (k: string, v: number | string) => { preds.push((r) => (r[k] as number | string) >= v); return b; };
      b.lt = (k: string, v: number | string) => { preds.push((r) => (r[k] as number | string) < v); return b; };
      b.lte = (k: string, v: number | string) => { preds.push((r) => (r[k] as number | string) <= v); return b; };
      b.order = () => b;
      b.range = (a: number, z: number) => { range = [a, z]; return b; };
      const run = () => {
        if (opts.failTable === table) return { data: null, count: null, error: { message: 'boom' } };
        let rows = (tables[table] ?? []).filter((r) => preds.every((p) => p(r)));
        if (head) return { data: null, count: rows.length, error: null };
        if (range) rows = rows.slice(range[0], range[1] + 1);
        return { data: rows, count: null, error: null };
      };
      b.maybeSingle = async () => {
        const r = run();
        return { data: (r.data as Row[] | null)?.[0] ?? null, error: r.error };
      };
      b.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(run()).then(resolve, reject);
      return b;
    },
    storage: {
      from: () => ({
        download: async (path: string) => {
          const bytes = opts.files?.[path];
          return bytes ? { data: new Blob([bytes as BlobPart]), error: null } : { data: null, error: { message: 'not found' } };
        },
      }),
    },
  } as unknown as SupabaseClient;
  return { db, queries };
}
