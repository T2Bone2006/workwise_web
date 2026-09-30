'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getTenantIdForCurrentUser } from '@/lib/data/tenant';
import { getTenantProducts } from '@/lib/data/tenant-products';
import { actOnReplyCore, markThreadRead } from '@/lib/messaging/replies';
import {
  saveMessagingSettingsCore,
  updateCustomerMessagingCore,
} from '@/lib/messaging/settings-core';
import {
  actOnReplySchema,
  customerMessagingSchema,
  messagingSettingsSchema,
} from '@/lib/validations/messaging';

function firstZodError(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Invalid input';
}

async function requireRounds(): Promise<
  | {
      success: true;
      tenantId: string;
      supabase: Awaited<ReturnType<typeof createClient>>;
      userId: string | null;
    }
  | { success: false; error: string }
> {
  const tenantId = await getTenantIdForCurrentUser();
  if (!tenantId) return { success: false, error: 'Not authenticated' };

  const products = await getTenantProducts();
  if (!products.hasRounds) {
    return { success: false, error: 'Not available' };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { success: true, tenantId, supabase, userId: user?.id ?? null };
}

export async function actOnReply(
  input: z.input<typeof actOnReplySchema>,
): Promise<Awaited<ReturnType<typeof actOnReplyCore>>> {
  const ctx = await requireRounds();
  if (!ctx.success) return ctx;

  const parsed = actOnReplySchema.safeParse(input);
  if (!parsed.success) return { success: false, error: firstZodError(parsed.error) };

  const result = await actOnReplyCore(await createClient(), {
    tenantId: ctx.tenantId,
    actor: { userId: ctx.userId ?? undefined },
    threadId: parsed.data.threadId,
    action: parsed.data.action,
    toDate: parsed.data.toDate,
    letThemKnow: parsed.data.letThemKnow,
  });

  if (result.success) {
    revalidatePath('/messages');
    revalidatePath('/dashboard');
    revalidatePath('/calendar');
  }
  return result;
}

export async function markThreadReadAction(
  threadId: string,
): Promise<{ success: boolean }> {
  const ctx = await requireRounds();
  if (!ctx.success) return ctx;

  const { data, error } = await ctx.supabase
    .from('message_threads')
    .select('id')
    .eq('id', threadId)
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle();
  if (error || !data) return { success: false };

  try {
    await markThreadRead(createAdminClient(), ctx.tenantId, threadId);
  } catch (err) {
    console.error(
      '[markThreadReadAction]',
      err instanceof Error ? err.message : 'failed',
    );
    return { success: false };
  }
  return { success: true };
}

/** Called from the browser after a thread is opened. revalidatePath cannot run during render. */
export async function revalidateMessagesInbox(): Promise<void> {
  const ctx = await requireRounds();
  if (!ctx.success) return;
  revalidatePath('/messages');
  revalidatePath('/', 'layout');
}

export async function updateMessagingSettings(
  input: z.input<typeof messagingSettingsSchema>,
): Promise<{ success: true } | { success: false; error: string }> {
  const ctx = await requireRounds();
  if (!ctx.success) return ctx;

  const parsed = messagingSettingsSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: firstZodError(parsed.error) };

  const result = await saveMessagingSettingsCore(ctx.supabase, ctx.tenantId, parsed.data);
  if (!result.success) return result;

  revalidatePath('/settings');
  revalidatePath('/messages');
  return { success: true };
}

export async function updateCustomerMessaging(
  input: z.input<typeof customerMessagingSchema>,
): Promise<{ success: true } | { success: false; error: string }> {
  const ctx = await requireRounds();
  if (!ctx.success) return ctx;

  const parsed = customerMessagingSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: firstZodError(parsed.error) };

  const result = await updateCustomerMessagingCore(ctx.supabase, ctx.tenantId, parsed.data);
  if (!result.success) return result;

  revalidatePath(`/customers/${parsed.data.customerId}`);
  return { success: true };
}

