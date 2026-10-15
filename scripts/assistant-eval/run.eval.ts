import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'dotenv';
import { it } from 'vitest';

/*
 * Asks the real assistant every question in questions.ts as the look-test
 * business "Test rounds 2", and writes what happened to report.md: which
 * tools it used, which cards and Do it cards it showed, and its words.
 * Do it is never tapped, so nothing in the business changes; each chat is
 * deleted afterwards. Run: npx vitest run -c vitest.eval.config.ts
 * Optional: EVAL_ONLY=3,7 to run some questions only.
 * EVAL_SET=pro runs pro-questions.ts as the "Pro Test" office instead (report-pro.md).
 */

const PRO = process.env.EVAL_SET === 'pro';
const TENANT = PRO ? 'b2c1a6ac-b9fd-4a2e-97b9-b8404359877b' : 'f571681c-3054-4836-8086-11c1777fc4ea'; // Pro Test / Test rounds 2

const env = parse(fs.readFileSync(path.join(__dirname, '../../.env.local')));
for (const [k, v] of Object.entries(env)) if (!(k in process.env)) process.env[k] = v;

it('answers every question', async () => {
  const { createAdminClient } = await import('@/lib/supabase/admin');
  const { runTurn } = await import('@/lib/assistant/run-turn');
  const { todayInLondon, addDays } = await import('@/lib/rounds/dates');
  const { QUESTIONS } = PRO ? await import('./pro-questions') : await import('./questions');
  const admin = createAdminClient();

  const { data: owner } = await admin.from('users').select('id').eq('tenant_id', TENANT).eq('role', 'admin').limit(1).single();
  const { data: subs } = await admin.from('subscriptions').select('product').eq('tenant_id', TENANT).in('status', ['trialing', 'active', 'past_due', 'manual']);
  const products = new Set((subs ?? []).map((s) => s.product as string));
  const { data: firstCustomer } = await admin.from('customers').select('id').eq('tenant_id', TENANT).eq('is_active', true).order('name').limit(1).maybeSingle();
  const { data: firstJob } = await admin.from('jobs').select('id').eq('tenant_id', TENANT).eq('status', 'incomplete').limit(1).maybeSingle();
  const { data: firstWorker } = await admin.from('workers').select('id').eq('primary_tenant_id', TENANT).eq('invite_status', 'accepted').order('full_name').limit(1).maybeSingle();
  const today = todayInLondon();
  const ctx = {
    db: admin,
    admin,
    tenantId: TENANT,
    userId: owner!.id as string,
    hasRounds: products.has('rounds'),
    hasLite: products.has('lite'),
    hasPro: ['starter', 'growth', 'pro'].some((p) => products.has(p)),
    surface: 'web' as const,
    today,
  };

  const only = process.env.EVAL_ONLY?.split(',').map((n) => Number(n.trim()));
  const lines: string[] = [`# Assistant eval — ${new Date().toISOString()}`, '', `Products: ${[...products].join(', ')}`, ''];
  let failures = 0;
  let totalPence = 0;
  let asked = 0;

  for (const [index, item] of QUESTIONS.entries()) {
    const n = index + 1;
    if (only && !only.includes(n)) continue;
    const page = item.page
      ? {
          ...item.page,
          path: item.page.path?.replace('__FIRST_CUSTOMER__', String(firstCustomer?.id ?? '')).replace('__FIRST_JOB__', String(firstJob?.id ?? '')).replace('__FIRST_WORKER__', String(firstWorker?.id ?? '')),
          ...(item.page.path?.includes('__FIRST_CUSTOMER__') ? { customerId: String(firstCustomer?.id ?? '') } : {}),
          ...(item.page.path?.includes('__FIRST_JOB__') ? { jobId: String(firstJob?.id ?? '') } : {}),
          ...(item.page.path?.includes('__FIRST_WORKER__') ? { workerId: String(firstWorker?.id ?? '') } : {}),
          ...(item.page.date === '__TOMORROW__' ? { date: addDays(today, 1) } : {}),
        }
      : null;
    const started = Date.now();
    let text = '';
    const statuses: string[] = [];
    const cards: string[] = [];
    const actions: string[] = [];
    const errors: string[] = [];
    let conversationId: string | null = null;
    let cost: { costUsd: number; uncachedInput: number; cacheWrite: number; cacheRead: number; output: number } | null = null;
    for await (const e of runTurn(ctx, { message: item.q, page, onUsage: (u) => (cost = u) })) {
      if (e.type === 'conversation') conversationId = e.id;
      else if (e.type === 'text') text += e.delta;
      else if (e.type === 'status') statuses.push(e.label);
      else if (e.type === 'card') cards.push(e.card.type === 'map' ? `map(${e.card.stops.length} stops, ${e.card.missing} unplaced)` : e.card.type);
      else if (e.type === 'action') actions.push(`${e.action.kind}: ${e.action.title}`);
      else if (e.type === 'error') errors.push(e.message);
    }
    const tools = conversationId
      ? (
          await admin.from('assistant_messages').select('content').eq('conversation_id', conversationId).eq('kind', 'answer').order('seq')
        ).data?.flatMap((r) => (r.content as Array<{ type: string; name?: string; input?: unknown }>).filter((b) => b.type === 'tool_use').map((b) => `${b.name}(${JSON.stringify(b.input)})`)) ?? []
      : [];

    const problems: string[] = [];
    const saysNone = /\b(no|none|nobody|nothing|isn't|aren't)\b/i.test(text.slice(0, 120));
    for (const want of item.expect?.cards ?? []) if (!cards.some((c) => c.startsWith(want)) && !saysNone) problems.push(`no ${want} card`);
    for (const want of item.expect?.actions ?? []) if (!actions.some((a) => a.startsWith(want))) problems.push(`no ${want} card`);
    if (item.expect?.noAction && actions.length > 0) problems.push('proposed a change it should have refused');
    if (errors.length) problems.push(`error: ${errors.join('; ')}`);
    if (!text.trim() && cards.length === 0 && actions.length === 0) problems.push('said nothing');
    // House style, checked on every answer.
    if (/[a-z0-9)][.!?][A-Z][a-z]/.test(text)) problems.push('sentences run together');
    if (/^\s*\|/m.test(text)) problems.push('used a table');
    if (/^(let me|i'll (check|look)|need |checking|looking up|first,? i)/im.test(text)) problems.push('narrated its steps');
    if (/\b(map|chart|graph|show me|list)\b/i.test(item.q) && cards.length === 0 && actions.length === 0 && !item.expect?.noAction && !saysNone) problems.push('asked to see something but no card');
    if (cards.some((c) => c.startsWith('map(') && !/ 0 unplaced/.test(c))) problems.push('map left stops off');
    const bulletLines = (text.match(/^\s*([-*•]|\d+[.)])\s+/gm) ?? []).length;
    if (cards.some((c) => c === 'list' || c === 'schedule' || c.startsWith('map')) && bulletLines >= 4) problems.push(`repeated the card in words (${bulletLines} list lines)`);
    if (problems.length) failures++;

    lines.push(
      `## ${n}. ${item.q}${page?.label ? `  _(on: ${page.label})_` : ''}`,
      '',
      `${problems.length ? `**PROBLEM:** ${problems.join('; ')}` : 'OK'} · ${((Date.now() - started) / 1000).toFixed(1)}s${cost ? ` · ${(((cost as { costUsd: number }).costUsd) * 79).toFixed(2)}p (fresh ${(cost as { uncachedInput: number }).uncachedInput}, cache write ${(cost as { cacheWrite: number }).cacheWrite}, cache read ${(cost as { cacheRead: number }).cacheRead}, out ${(cost as { output: number }).output} tokens)` : ''}`,
      '',
      `- Tools: ${tools.length ? tools.join(' → ') : 'none'}`,
      `- Cards: ${cards.length ? cards.join(', ') : 'none'}`,
      `- Do it cards: ${actions.length ? actions.join(' | ') : 'none'}`,
      '',
      text.trim().split('\n').map((l) => `> ${l}`).join('\n'),
      '',
    );
    if (conversationId) await admin.from('assistant_conversations').delete().eq('id', conversationId);
    console.log(`${n}. ${problems.length ? 'PROBLEM' : 'ok'} — ${item.q}`);
    if (cost) totalPence += (cost as { costUsd: number }).costUsd * 79;
    asked++;
  }

  lines.splice(3, 0, `**${failures} question(s) with problems.** Cost: ${totalPence.toFixed(1)}p for ${asked} questions, ${(totalPence / Math.max(1, asked)).toFixed(2)}p each on average.`, '');
  fs.writeFileSync(path.join(__dirname, PRO ? 'report-pro.md' : 'report.md'), lines.join('\n'));
});
