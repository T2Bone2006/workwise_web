import type { z } from 'zod';
import type { AssistantCtx } from '@/lib/assistant/caller';
import type { AssistantAction, AssistantCard } from '@/lib/assistant/shared';

export type ToolOutcome = {
  /** What Claude reads back (JSON text). */
  content: string;
  isError?: boolean;
  cards?: AssistantCard[];
  action?: AssistantAction;
};

export type ToolMeta = { conversationId: string; toolUseId: string };

export type ToolDef<S extends z.ZodType = z.ZodType> = {
  name: string;
  description: string;
  schema: S;
  /** Which product makes the tool available. */
  product: 'rounds' | 'lite' | 'pro' | 'any';
  /** Shown while it runs, e.g. "Looking at your calendar". */
  status: string;
  run: (ctx: AssistantCtx, input: z.output<S>, meta: ToolMeta) => Promise<ToolOutcome>;
};

export function defineTool<S extends z.ZodType>(def: ToolDef<S>): ToolDef<S> {
  return def;
}

export function ok(data: unknown, extra?: Omit<ToolOutcome, 'content'>): ToolOutcome {
  return { content: JSON.stringify(data), ...extra };
}

export function toolError(message: string): ToolOutcome {
  return { content: JSON.stringify({ error: message }), isError: true };
}
