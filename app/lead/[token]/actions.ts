'use server';

import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { resolveLeadToken, touchLeadToken } from '@/lib/lite/action-tokens';
import { loadLeadLinkView, type LeadLinkView } from '@/lib/lite/lead-link-view';
import { decideBooking } from '@/lib/lite/leads-core';
import { createAdminClient } from '@/lib/supabase/admin';

export type LinkDecisionResult =
  | { success: true; view: LeadLinkView }
  | { success: false; error: string };

const LINK_BROKEN = "This link doesn't work.";
const LINK_EXPIRED = 'This link has expired — open WorkWise to decide.';
const PRICE_ERROR = 'Enter a price between £1 and £50,000.';
const NOT_FIRM = 'Change price is only for a firm quote.';
const SAVE_FAILED = "Couldn't save that. Try again.";

const schema = z
  .object({
    token: z.string().min(1),
    decision: z.enum(['accept', 'decline', 'change_price']),
    amount: z.unknown().optional(),
    tellCustomer: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.decision !== 'change_price') return;
    if (!isLinkPrice(value.amount)) {
      ctx.addIssue({ code: 'custom', path: ['amount'], message: PRICE_ERROR });
    }
  });

function isLinkPrice(amount: unknown): amount is number {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return false;
  const rounded = Math.round(amount * 100) / 100;
  if (Math.abs(rounded - amount) > 1e-6) return false;
  return rounded >= 1 && rounded <= 50000;
}

function rejected(error: z.ZodError): string {
  if (error.issues.some((issue) => issue.path[0] === 'amount')) return PRICE_ERROR;
  return LINK_BROKEN;
}

async function freshView(admin: SupabaseClient, rawToken: string): Promise<LinkDecisionResult> {
  try {
    const view = await loadLeadLinkView(admin, rawToken);
    return { success: true, view };
  } catch {
    return { success: false, error: SAVE_FAILED };
  }
}

export async function decideFromLinkAction(input: {
  token: string;
  decision: 'accept' | 'decline' | 'change_price';
  amount?: number;
  tellCustomer?: boolean;
}): Promise<LinkDecisionResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { success: false, error: rejected(parsed.error) };

  const admin = createAdminClient();
  const token = await resolveLeadToken(admin, parsed.data.token);
  if (token === 'invalid') return { success: false, error: LINK_BROKEN };
  if (token === 'expired') return { success: false, error: LINK_EXPIRED };
  if (token === 'error') return { success: false, error: SAVE_FAILED };

  const decision = parsed.data.decision;
  const newAmount = decision === 'change_price' && isLinkPrice(parsed.data.amount) ? parsed.data.amount : undefined;
  const result = await decideBooking(admin, {
    tenantId: token.tenantId,
    leadId: token.leadId,
    by: 'owner',
    decision,
    ...(newAmount != null ? { newAmount } : {}),
    ...(decision === 'decline' ? { tellCustomer: parsed.data.tellCustomer ?? true } : {}),
  });
  await touchLeadToken(admin, token.tokenId);

  if (!result.ok && result.error !== 'not_requested') {
    if (result.error === 'bad_amount') return { success: false, error: PRICE_ERROR };
    if (result.error === 'not_firm') return { success: false, error: NOT_FIRM };
    if (result.error === 'not_found') return { success: false, error: LINK_BROKEN };
    return { success: false, error: SAVE_FAILED };
  }
  return freshView(admin, parsed.data.token);
}
