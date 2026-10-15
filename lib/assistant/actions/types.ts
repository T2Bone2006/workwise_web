import type { z } from 'zod';
import type { AssistantCtx } from '@/lib/assistant/caller';
import type { CardTone } from '@/lib/assistant/shared';

export type Preview = {
  title: string;
  lines: string[];
  confirmLabel: string;
  tone: CardTone;
  note?: string;
  href?: string;
};

export type Prepared<P> = { ok: true; params: P; preview: Preview } | { ok: false; error: string };

export type Executed =
  | {
      ok: true;
      /** One sentence for the card and for Claude, e.g. "Moved 3 visits to Thu 10 Oct." */
      result: string;
      /** Kept on the row for Undo (payment id, expense id…). */
      data?: Record<string, unknown>;
      changeId?: string | null;
      href?: string;
    }
  | { ok: false; error: string };

export type ActionDef<S extends z.ZodType = z.ZodType, P = unknown> = {
  name: string;
  description: string;
  schema: S;
  product: 'rounds' | 'lite' | 'pro';
  status: string;
  /** Checks everything and works out the card. Changes nothing. */
  prepare: (ctx: AssistantCtx, input: z.output<S>) => Promise<Prepared<P>>;
  /** Runs after Do it, with the params saved by prepare. Must re-check anything that can change. */
  execute: (ctx: AssistantCtx, params: P, actionId: string) => Promise<Executed>;
  undo?: (
    ctx: AssistantCtx,
    params: P,
    saved: { data: Record<string, unknown>; changeId: string | null },
  ) => Promise<{ ok: true; result: string } | { ok: false; error: string }>;
};

export function defineAction<S extends z.ZodType, P>(def: ActionDef<S, P>): ActionDef<S, P> {
  return def;
}
