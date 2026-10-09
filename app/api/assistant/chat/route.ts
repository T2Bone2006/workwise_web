import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAssistantCaller } from '@/lib/assistant/caller';
import { runTurn } from '@/lib/assistant/run-turn';

export const runtime = 'nodejs';
export const maxDuration = 120;

const bodySchema = z.object({
  conversationId: z.string().uuid().nullable().optional(),
  message: z.string().trim().min(1, 'Ask me something').max(2000, 'That is a bit long — try a shorter question'),
  page: z
    .object({
      path: z.string().max(200).optional(),
      customerId: z.string().uuid().optional(),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      leadId: z.string().uuid().optional(),
      jobId: z.string().uuid().optional(),
      workerId: z.string().uuid().optional(),
      label: z.string().max(120).optional(),
    })
    .nullable()
    .optional(),
});

/** One question; the answer streams back as NDJSON (one StreamEvent per line). */
export async function POST(request: Request) {
  const auth = await requireAssistantCaller(request);
  if (!auth.ok) return auth.response;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const events = runTurn(auth.ctx, parsed.data);
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await events.next();
        if (next.done) {
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(`${JSON.stringify(next.value)}\n`));
      } catch (err) {
        console.error('[api/assistant/chat]', err instanceof Error ? err.message : err);
        controller.enqueue(
          encoder.encode(`${JSON.stringify({ type: 'error', code: 'failed', message: "Sorry, I couldn't finish that. Try again in a minute." })}\n`),
        );
        controller.close();
      }
    },
    async cancel() {
      await events.return(undefined);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    },
  });
}
