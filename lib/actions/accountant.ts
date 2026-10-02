'use server';

import { revalidatePath } from 'next/cache';
import {
  inviteAccountant,
  listAccess,
  removeAccountant,
  resendInvite,
} from '@/lib/accountant/access';
import { MAX_ACCOUNTANTS } from '@/lib/accountant/limits';
import { requireAdminRounds } from '@/lib/auth/require-admin-rounds';
import { sendAccountantInvite } from '@/lib/emails/accountant-invite';
import { createAdminClient } from '@/lib/supabase/admin';

const NOT_ROUNDS = 'Accountant access is part of Rounds.';
const EMAIL_FAILED = "Couldn't send the email. Try again.";
const AT_LIMIT = `You can give up to ${MAX_ACCOUNTANTS} people access.`;

type Failure = { success: false; error: string };

async function businessName(admin: ReturnType<typeof createAdminClient>, tenantId: string): Promise<string> {
  const { data } = await admin.from('tenants').select('name').eq('id', tenantId).maybeSingle();
  return (data as { name?: string } | null)?.name?.trim() || 'Your client';
}

/**
 * Give an accountant read-only access and email them their link. If the email
 * can't be sent the access is removed again, so there is never invisible access
 * the accountant has no link to.
 */
export async function inviteAccountantAction(input: {
  email: string;
  name?: string;
}): Promise<{ success: true } | Failure> {
  const ctx = await requireAdminRounds(NOT_ROUNDS);
  if (!ctx.success) return ctx;

  const admin = createAdminClient();
  try {
    if ((await listAccess(admin, ctx.tenantId)).length >= MAX_ACCOUNTANTS) {
      return { success: false, error: AT_LIMIT };
    }
  } catch {
    return { success: false, error: "Couldn't do that. Try again." };
  }

  const invited = await inviteAccountant(admin, {
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    email: String(input?.email ?? ''),
    name: input?.name ?? null,
  });
  if (!invited.ok) return { success: false, error: invited.error };

  const email = String(input.email).trim().toLowerCase();
  const sent = await sendAccountantInvite({
    to: email,
    businessName: await businessName(admin, ctx.tenantId),
    inviterName: null,
    linkToken: invited.linkToken,
  });
  if (!sent.ok) {
    await removeAccountant(admin, { tenantId: ctx.tenantId, accessId: invited.accessId, userId: ctx.userId });
    revalidatePath('/settings');
    return { success: false, error: EMAIL_FAILED };
  }

  revalidatePath('/settings');
  return { success: true };
}

/** A new link for an accountant. The old emailed link stops working at once. */
export async function resendAccountantInviteAction(input: {
  accessId: string;
}): Promise<{ success: true } | Failure> {
  const ctx = await requireAdminRounds(NOT_ROUNDS);
  if (!ctx.success) return ctx;

  const admin = createAdminClient();
  const rotated = await resendInvite(admin, { tenantId: ctx.tenantId, accessId: String(input?.accessId ?? '') });
  if (!rotated.ok) return { success: false, error: rotated.error };

  const sent = await sendAccountantInvite({
    to: rotated.email,
    businessName: await businessName(admin, ctx.tenantId),
    inviterName: null,
    linkToken: rotated.linkToken,
  });
  // The new link only exists in that email: if it failed, pressing this again makes another.
  if (!sent.ok) return { success: false, error: EMAIL_FAILED };

  revalidatePath('/settings');
  return { success: true };
}

/** Remove an accountant. Their link and any open session stop working straight away. */
export async function removeAccountantAction(input: { accessId: string }): Promise<{ success: true } | Failure> {
  const ctx = await requireAdminRounds(NOT_ROUNDS);
  if (!ctx.success) return ctx;

  const result = await removeAccountant(createAdminClient(), {
    tenantId: ctx.tenantId,
    accessId: String(input?.accessId ?? ''),
    userId: ctx.userId,
  });
  if (!result.ok) return { success: false, error: result.error };

  revalidatePath('/settings');
  return { success: true };
}
