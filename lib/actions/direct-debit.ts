'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  cancelDirectDebit,
  resolveFailedCollection,
} from '@/lib/direct-debit/after-collection';
import {
  ignoreExistingMandate,
  linkExistingMandate,
  refreshMandateLinks,
  unlinkExistingMandate,
  type RefreshSummary,
} from '@/lib/direct-debit/existing';
import { getDirectDebitLink, sendDirectDebitInvite } from '@/lib/direct-debit/setup';
import {
  directDebitState,
  getDirectDebitState,
  type DirectDebitState,
} from '@/lib/direct-debit/state';
import { getConnection, refreshVerification } from '@/lib/gocardless/connection';
import { disconnectGoCardless } from '@/lib/gocardless/oauth';
import { getTenantIdForCurrentUser } from '@/lib/data/tenant';
import { getTenantProducts } from '@/lib/data/tenant-products';
import { isTenantAdmin } from '@/lib/stripe/connect';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

export type DdActionResult = { ok: true } | { ok: false; error: string };

const NOT_ON = "Direct Debit isn't on yet — connect GoCardless in Settings → Payments.";
const uuid = z.string().uuid('Invalid id.');

type Owner = {
  ok: true;
  tenantId: string;
  userId: string;
  admin: ReturnType<typeof createAdminClient>;
};

/** Session tenant → Rounds → owner (admin) — in that order. The tenant and user never come from the caller. */
async function requireOwner(): Promise<Owner | { ok: false; error: string }> {
  const tenantId = await getTenantIdForCurrentUser();
  if (!tenantId) return { ok: false, error: 'Not signed in.' };

  const products = await getTenantProducts();
  if (!products.hasRounds) return { ok: false, error: 'Rounds only.' };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) return { ok: false, error: 'Not signed in.' };
  if (!(await isTenantAdmin(supabase, user.id))) {
    return { ok: false, error: 'Only the account owner can do this.' };
  }
  return { ok: true, tenantId, userId: user.id, admin: createAdminClient() };
}

function invalid(error: z.ZodError): { ok: false; error: string } {
  return { ok: false, error: error.issues[0]?.message ?? 'Invalid input.' };
}

function revalidateDirectDebit(customerId?: string): void {
  if (customerId) revalidatePath(`/customers/${customerId}`);
  else revalidatePath('/customers/[id]', 'page');
  revalidatePath('/payments');
  revalidatePath('/settings');
  revalidatePath('/payments/direct-debits');
}

export async function refreshGoCardlessStatusAction(): Promise<
  { ok: true; state: DirectDebitState } | { ok: false; error: string }
> {
  const owner = await requireOwner();
  if (!owner.ok) return owner;
  const connection = await refreshVerification(owner.admin, owner.tenantId, { force: true });
  revalidateDirectDebit();
  return { ok: true, state: directDebitState(connection) };
}

export async function disconnectGoCardlessAction(): Promise<DdActionResult> {
  const owner = await requireOwner();
  if (!owner.ok) return owner;
  await disconnectGoCardless(owner.admin, { tenantId: owner.tenantId });
  revalidateDirectDebit();
  return { ok: true };
}

export async function checkExistingDirectDebitsAction(): Promise<
  { ok: true; summary: RefreshSummary } | { ok: false; error: string }
> {
  const owner = await requireOwner();
  if (!owner.ok) return owner;
  const connection = await getConnection(owner.admin, owner.tenantId);
  if (connection?.status !== 'connected') return { ok: false, error: 'Connect GoCardless first.' };
  try {
    const summary = await refreshMandateLinks(owner.admin, owner.tenantId);
    revalidateDirectDebit();
    return { ok: true, summary };
  } catch (err) {
    console.error('[direct-debit action] check existing', err instanceof Error ? err.message : 'error');
    return { ok: false, error: "Couldn't reach GoCardless — try again in a minute." };
  }
}

const linkSchema = z.object({
  linkId: uuid,
  customerId: uuid,
  confirmStoppedOldApp: z.boolean(),
});

export async function linkExistingDirectDebitAction(input: {
  linkId: string;
  customerId: string;
  confirmStoppedOldApp: boolean;
}): Promise<DdActionResult> {
  const owner = await requireOwner();
  if (!owner.ok) return owner;
  const parsed = linkSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const result = await linkExistingMandate(owner.admin, {
    tenantId: owner.tenantId,
    userId: owner.userId,
    ...parsed.data,
  });
  if (!result.ok) return result;
  revalidateDirectDebit(parsed.data.customerId);
  return { ok: true };
}

const linkIdSchema = z.object({ linkId: uuid });

export async function ignoreExistingDirectDebitAction(input: { linkId: string }): Promise<DdActionResult> {
  const owner = await requireOwner();
  if (!owner.ok) return owner;
  const parsed = linkIdSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const result = await ignoreExistingMandate(owner.admin, {
    tenantId: owner.tenantId,
    userId: owner.userId,
    linkId: parsed.data.linkId,
  });
  if (!result.ok) return result;
  revalidateDirectDebit();
  return { ok: true };
}

export async function unlinkExistingDirectDebitAction(input: { linkId: string }): Promise<DdActionResult> {
  const owner = await requireOwner();
  if (!owner.ok) return owner;
  const parsed = linkIdSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const result = await unlinkExistingMandate(owner.admin, {
    tenantId: owner.tenantId,
    userId: owner.userId,
    linkId: parsed.data.linkId,
  });
  if (!result.ok) return result;
  revalidateDirectDebit();
  return { ok: true };
}

const customerSchema = z.object({ customerId: uuid });

export async function sendDirectDebitInviteAction(input: {
  customerId: string;
}): Promise<{ ok: true; channel: 'email' | 'sms' } | { ok: false; error: string }> {
  const owner = await requireOwner();
  if (!owner.ok) return owner;
  const parsed = customerSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  if ((await getDirectDebitState(owner.admin, owner.tenantId)) !== 'on') {
    return { ok: false, error: NOT_ON };
  }
  const result = await sendDirectDebitInvite(owner.admin, {
    tenantId: owner.tenantId,
    customerId: parsed.data.customerId,
  });
  if (!result.ok) return result;
  revalidateDirectDebit(parsed.data.customerId);
  return result;
}

export async function getDirectDebitLinkAction(input: {
  customerId: string;
}): Promise<{ ok: true; url: string; shareText: string } | { ok: false; error: string }> {
  const owner = await requireOwner();
  if (!owner.ok) return owner;
  const parsed = customerSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return getDirectDebitLink(owner.admin, {
    tenantId: owner.tenantId,
    customerId: parsed.data.customerId,
  });
}

const resolveSchema = z.object({
  collectionId: uuid,
  action: z.enum(['collect_again', 'leave']),
});

export async function resolveFailedCollectionAction(input: {
  collectionId: string;
  action: 'collect_again' | 'leave';
}): Promise<DdActionResult> {
  const owner = await requireOwner();
  if (!owner.ok) return owner;
  const parsed = resolveSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const result = await resolveFailedCollection(owner.admin, {
    tenantId: owner.tenantId,
    userId: owner.userId,
    ...parsed.data,
  });
  if (!result.ok) return result;
  revalidateDirectDebit();
  return { ok: true };
}

export async function cancelDirectDebitAction(input: {
  customerId: string;
}): Promise<{ ok: true; stillCollecting: number } | { ok: false; error: string }> {
  const owner = await requireOwner();
  if (!owner.ok) return owner;
  const parsed = customerSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const result = await cancelDirectDebit(owner.admin, {
    tenantId: owner.tenantId,
    userId: owner.userId,
    customerId: parsed.data.customerId,
  });
  if (!result.ok) return result;
  revalidateDirectDebit(parsed.data.customerId);
  return result;
}
