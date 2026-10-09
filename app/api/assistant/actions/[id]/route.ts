import { NextResponse } from 'next/server';
import { z } from 'zod';
import { decideAction } from '@/lib/assistant/decide';
import { requireAssistantCaller } from '@/lib/assistant/caller';

const bodySchema = z.object({ decision: z.enum(['confirm', 'cancel', 'undo']) });

/** Do it, Cancel or Undo on an assistant card. Returns the card as it now stands. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAssistantCaller(request);
  if (!auth.ok) return auth.response;
  const id = z.string().uuid().safeParse((await context.params).id);
  if (!id.success) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 });

  const result = await decideAction(auth.ctx, id.data, parsed.data.decision);
  return NextResponse.json(result.body, { status: result.status, headers: { 'Cache-Control': 'no-store' } });
}
