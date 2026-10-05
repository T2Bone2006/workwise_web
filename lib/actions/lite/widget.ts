'use server';

import { revalidatePath } from 'next/cache';
import {
  saveWidgetLook,
  saveWidgetTexts,
  saveWidgetWebsite,
  setWidgetActive,
} from '@/lib/lite/widget-settings';
import { requireLite } from '@/lib/lite/require-lite';
import { createAdminClient } from '@/lib/supabase/admin';
import { widgetLookSchema, widgetTextsSchema, widgetWebsiteSchema } from '@/lib/validations/lite/widget';

type ActionResult = { success: true; note?: string } | { success: false; error: string };

const WEBSITE_ERROR = "That doesn't look like a website address \u2014 try something like daveplastering.co.uk";

function refresh(): void {
  revalidatePath('/lite/widget');
}

export async function saveWidgetWebsiteAction(website: string): Promise<ActionResult> {
  const auth = await requireLite();
  if (!auth.ok) return { success: false, error: auth.error };
  const parsed = widgetWebsiteSchema.safeParse({ website });
  if (!parsed.success) return { success: false, error: WEBSITE_ERROR };
  const result = await saveWidgetWebsite(createAdminClient(), auth.ctx, parsed.data.website);
  if (!result.ok) return { success: false, error: result.error };
  refresh();
  return { success: true };
}

export async function saveWidgetLookAction(v: unknown): Promise<ActionResult> {
  const auth = await requireLite();
  if (!auth.ok) return { success: false, error: auth.error };
  const parsed = widgetLookSchema.safeParse(v);
  if (!parsed.success) {
    const colour = parsed.error.issues.some((issue) => issue.path[0] === 'primaryColour');
    return {
      success: false,
      error: colour ? 'Pick a colour like #0C66E4.' : 'Write a greeting between 5 and 200 characters.',
    };
  }
  const result = await saveWidgetLook(createAdminClient(), auth.ctx, parsed.data);
  if (!result.ok) return { success: false, error: result.error };
  refresh();
  return { success: true };
}

export async function saveWidgetTextsAction(v: unknown): Promise<ActionResult> {
  const auth = await requireLite();
  if (!auth.ok) return { success: false, error: auth.error };
  const parsed = widgetTextsSchema.safeParse(v);
  if (!parsed.success) {
    const path = parsed.error.issues[0]?.path[0];
    if (path === 'notificationEmail') return { success: false, error: 'Please check the email address.' };
    if (path === 'ownerMobile') return { success: false, error: 'Please enter a UK mobile number.' };
    if (path === 'signOffName') return { success: false, error: 'Add the name to sign texts with.' };
    return { success: false, error: "Couldn't save that. Try again." };
  }
  const result = await saveWidgetTexts(createAdminClient(), auth.ctx, parsed.data);
  if (!result.ok) return { success: false, error: result.error };
  refresh();
  return result.note ? { success: true, note: result.note } : { success: true };
}

export async function setWidgetActiveAction(active: boolean): Promise<ActionResult> {
  const auth = await requireLite();
  if (!auth.ok) return { success: false, error: auth.error };
  const result = await setWidgetActive(createAdminClient(), auth.ctx, active);
  if (!result.ok) return { success: false, error: result.error };
  refresh();
  return { success: true };
}
