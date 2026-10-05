import { boardLeadFromSource, mapLeadRow } from '@/lib/data/lite/leads-board';
import { icsFile, leadCalendarEvent } from '@/lib/lite/calendar';
import { requireLite } from '@/lib/lite/require-lite';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function text(body: string, status: number): Response {
  return new Response(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

/** A calendar file for one accepted booking. Signed-in owner of that business only. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireLite();
  if (!auth.ok) return text(auth.error, auth.status);

  const { id } = await context.params;
  if (!UUID.test(id)) return text('That lead could not be found.', 404);

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('leads')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', auth.ctx.tenantId)
      .maybeSingle();
    if (error || !data) return text('That lead could not be found.', 404);

    const source = mapLeadRow(data);
    if (!source) return text('That lead could not be found.', 404);
    const event = leadCalendarEvent(boardLeadFromSource(source));
    if (!event) return text('This booking has no date yet.', 409);

    return new Response(icsFile(event, new Date()), {
      status: 200,
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': `attachment; filename="booking-${event.date}.ics"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch {
    return text('That lead could not be found.', 404);
  }
}
