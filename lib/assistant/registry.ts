import 'server-only';

import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { LITE_ACTIONS, READ_LITE_TOOLS } from '@/lib/assistant/actions/lite';
import { PRO_ACTIONS } from '@/lib/assistant/actions/pro';
import { ROUNDS_ACTIONS } from '@/lib/assistant/actions/rounds';
import type { ActionDef } from '@/lib/assistant/actions/types';
import { actionCard, insertAction } from '@/lib/assistant/store';
import { howTo } from '@/lib/assistant/tools/how-to';
import { READ_PRO_TOOLS } from '@/lib/assistant/tools/read-pro';
import { READ_ROUNDS_TOOLS } from '@/lib/assistant/tools/read-rounds';
import { ok, toolError, type ToolDef } from '@/lib/assistant/tools/types';

/* eslint-disable @typescript-eslint/no-explicit-any -- the registry holds tools of every input type */
type AnyTool = ToolDef<any>;
type AnyAction = ActionDef<any, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

const ALL_ACTIONS: AnyAction[] = [...ROUNDS_ACTIONS, ...LITE_ACTIONS, ...PRO_ACTIONS];

export const ACTIONS_BY_KIND: ReadonlyMap<string, AnyAction> = new Map(ALL_ACTIONS.map((a) => [a.name, a]));

/** An action becomes a tool that only prepares the card; Do it runs it later. */
function actionTool(def: AnyAction): AnyTool {
  return {
    name: def.name,
    description: def.description,
    schema: def.schema,
    product: def.product,
    status: def.status,
    async run(ctx, input, meta) {
      const prepared = await def.prepare(ctx, input);
      if (!prepared.ok) return toolError(prepared.error);
      const row = await insertAction(ctx.admin, {
        conversationId: meta.conversationId,
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        toolUseId: meta.toolUseId,
        kind: def.name,
        params: prepared.params,
        preview: prepared.preview,
      });
      if (!row) return toolError('Could not show the card. Try again.');
      return ok(
        {
          shown_to_them: true,
          card: { title: prepared.preview.title, lines: prepared.preview.lines },
          next: 'Waiting for them to tap Do it or Cancel. Nothing has changed yet. You will be told the outcome in their next message.',
        },
        { action: actionCard(row, Boolean(def.undo)) },
      );
    },
  };
}

const ROUNDS_TOOLS: AnyTool[] = [...READ_ROUNDS_TOOLS, ...ROUNDS_ACTIONS.map(actionTool)];
const LITE_TOOLS: AnyTool[] = [...READ_LITE_TOOLS, ...LITE_ACTIONS.map(actionTool)];
const PRO_TOOLS: AnyTool[] = [...READ_PRO_TOOLS, ...PRO_ACTIONS.map(actionTool)];

/** Fixed order (prompt caching needs the same bytes every turn). */
export function toolsFor(products: { rounds: boolean; lite: boolean; pro?: boolean }): AnyTool[] {
  return [howTo as AnyTool, ...(products.pro ? PRO_TOOLS : []), ...(products.rounds ? ROUNDS_TOOLS : []), ...(products.lite ? LITE_TOOLS : [])];
}

const schemaCache = new Map<string, Anthropic.Tool.InputSchema>();

function inputSchema(tool: AnyTool): Anthropic.Tool.InputSchema {
  const cached = schemaCache.get(tool.name);
  if (cached) return cached;
  const json = z.toJSONSchema(tool.schema, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;
  delete json.$schema;
  const schema = { ...json, type: 'object' } as Anthropic.Tool.InputSchema;
  schemaCache.set(tool.name, schema);
  return schema;
}

/**
 * The tool list Claude sees. The last one carries a 1-hour cache mark, so the
 * whole tool list (identical for every business with the same products) is
 * cached once and shared by everyone.
 */
export function anthropicTools(tools: AnyTool[]): Anthropic.Tool[] {
  return tools.map((t, i) => ({
    name: t.name,
    description: t.description,
    input_schema: inputSchema(t),
    ...(i === tools.length - 1 ? { cache_control: { type: 'ephemeral' as const, ttl: '1h' as const } } : {}),
  }));
}

export type { AnyTool };
