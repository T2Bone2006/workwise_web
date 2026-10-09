import fs from 'node:fs';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { parse } from 'dotenv';
import { it } from 'vitest';

/** How big each part of what the assistant sends is, in tokens (count_tokens is free). */
const env = parse(fs.readFileSync(path.join(__dirname, '../../.env.local')));
for (const [k, v] of Object.entries(env)) if (!(k in process.env)) process.env[k] = v;

it('measures the parts', async () => {
  const { buildSystemPrompt } = await import('@/lib/assistant/prompt');
  const { anthropicTools, toolsFor } = await import('@/lib/assistant/registry');
  const { ASSISTANT_AI_MODEL } = await import('@/lib/ai/model');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const system = buildSystemPrompt({ hasRounds: true, hasLite: true, surface: 'web' });
  const tools = anthropicTools(toolsFor({ rounds: true, lite: true }));
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: 'hi' }];
  const count = async (p: { system?: string; tools?: Anthropic.Tool[] }) =>
    (await client.messages.countTokens({ model: ASSISTANT_AI_MODEL, messages, ...p })).input_tokens;
  const bare = await count({});
  const withSystem = await count({ system });
  const withTools = await count({ tools });
  const all = await count({ system, tools });
  const perTool = await Promise.all(tools.map(async (t) => [t.name, (await count({ tools: [t] })) - bare] as const));
  fs.writeFileSync(path.join(__dirname, 'size.json'), JSON.stringify({ bare, systemPrompt: withSystem - bare, allTools: withTools - bare, together: all - bare, perTool: Object.fromEntries(perTool) }, null, 1));

  // The Pro office's own prefix (its own prompt and tools; shared by every Pro business).
  const proSystem = buildSystemPrompt({ hasRounds: false, hasLite: false, hasPro: true, surface: 'web' });
  const proTools = anthropicTools(toolsFor({ rounds: false, lite: false, pro: true }));
  const proWithSystem = await count({ system: proSystem });
  const proWithTools = await count({ tools: proTools });
  const proAll = await count({ system: proSystem, tools: proTools });
  const proPerTool = await Promise.all(proTools.map(async (t) => [t.name, (await count({ tools: [t] })) - bare] as const));
  fs.writeFileSync(path.join(__dirname, 'size-pro.json'), JSON.stringify({ bare, systemPrompt: proWithSystem - bare, allTools: proWithTools - bare, together: proAll - bare, perTool: Object.fromEntries(proPerTool) }, null, 1));
});
