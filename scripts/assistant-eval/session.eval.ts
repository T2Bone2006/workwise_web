import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'dotenv';
import { it } from 'vitest';

/*
 * What a realistic session costs: one conversation, a worker's questions in
 * their own words with follow-ups, as Test rounds 2. Prints the cost of each
 * question (with prompt caching) and the total. Never taps Do it; the chat is
 * deleted afterwards. Run: npx vitest run -c vitest.eval.config.ts session
 */

const TENANT = 'f571681c-3054-4836-8086-11c1777fc4ea'; // Test rounds 2
const env = parse(fs.readFileSync(path.join(__dirname, '../../.env.local')));
for (const [k, v] of Object.entries(env)) if (!(k in process.env)) process.env[k] = v;

const SESSION = [
  'whats left today',
  'show me on a map',
  'skip number 2 no access',
  'who owes me money',
  'email the top 2 their pay link',
  'how much did i take last month',
  'and the month before?',
  'spent 48 on diesel',
];

it('costs a sensible amount for a normal session', async () => {
  const { createAdminClient } = await import('@/lib/supabase/admin');
  const { runTurn } = await import('@/lib/assistant/run-turn');
  const { todayInLondon } = await import('@/lib/rounds/dates');
  const admin = createAdminClient();
  const { data: owner } = await admin.from('users').select('id').eq('tenant_id', TENANT).eq('role', 'admin').limit(1).single();
  const ctx = { db: admin, admin, tenantId: TENANT, userId: owner!.id as string, hasRounds: true, hasLite: true, hasPro: false, surface: 'phone' as const, today: todayInLondon() };

  let conversationId: string | null = null;
  let total = 0;
  const rows: string[] = [];
  for (const q of SESSION) {
    let cost = 0;
    let detail = '';
    for await (const e of runTurn(ctx, {
      conversationId,
      message: q,
      onUsage: (u) => {
        cost = u.costUsd;
        detail = `${u.toolCalls} tools, new ${u.uncachedInput}, cache write ${u.cacheWrite}, cache read ${u.cacheRead}, out ${u.output}`;
      },
    })) {
      if (e.type === 'conversation') conversationId = e.id;
    }
    total += cost;
    rows.push(`$${cost.toFixed(4)}  ${q.padEnd(34)} ${detail}`);
  }
  if (conversationId) await admin.from('assistant_conversations').delete().eq('id', conversationId);
  fs.writeFileSync(path.join(__dirname, 'session-cost.txt'), `${rows.join('\n')}\nTOTAL $${total.toFixed(3)} for ${SESSION.length} questions, $${(total / SESSION.length).toFixed(4)} each\n`);
});
