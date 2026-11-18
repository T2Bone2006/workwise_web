import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

export type OwnerEmailContent = { subject: string; html: string; text: string };

/** The business owner's email (the account's admin user), or null. Never throws. */
export async function ownerEmailFor(admin: SupabaseClient, tenantId: string): Promise<string | null> {
  try {
    const { data, error } = await admin
      .from('users')
      .select('email')
      .eq('tenant_id', tenantId)
      .eq('role', 'admin')
      .limit(1)
      .maybeSingle();
    if (error) {
      console.error('[ownerEmailFor]', error.message);
      return null;
    }
    const email = (data as { email?: unknown } | null)?.email;
    return typeof email === 'string' && email.includes('@') ? email : null;
  } catch (err) {
    console.error('[ownerEmailFor]', err instanceof Error ? err.message : String(err));
    return null;
  }
}

/** Send one plain notice to the owner. `idempotencyKey` makes a retry harmless. Never throws. */
export async function sendOwnerEmail(p: {
  to: string;
  content: OwnerEmailContent;
  idempotencyKey: string;
}): Promise<{ ok: boolean }> {
  try {
    const { resend, FROM_EMAIL } = await import('@/lib/resend');
    const key = p.idempotencyKey.replace(/[^A-Za-z0-9_:.-]/g, '').slice(0, 250);
    const { error } = await resend.emails.send(
      {
        from: FROM_EMAIL,
        to: p.to,
        replyTo: 'support@joinworkwise.com',
        subject: p.content.subject,
        html: p.content.html,
        text: p.content.text,
      },
      { idempotencyKey: key },
    );
    if (error) {
      console.error('[owner-notice] email not sent', { error: error.name ?? 'ResendError' });
      return { ok: false };
    }
    return { ok: true };
  } catch (err) {
    console.error('[owner-notice] email threw', err instanceof Error ? err.message : String(err));
    return { ok: false };
  }
}
