import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { RECEIPT_AI_MODEL, RECEIPT_ESCALATION_MODEL, supportsEffort } from '@/lib/ai/model';
import { logStructuredAiInteraction } from '@/lib/services/ai-interaction-log';
import { londonDayBoundsUtc, todayInLondon } from '@/lib/rounds/dates';
import {
  needsEscalation,
  ReceiptReadSchema,
  toDraftFields,
  type ReceiptRead,
} from '@/lib/expenses/receipt-schema';

export const RECEIPT_BUCKET = 'expense-receipts';
export const MAX_RECEIPT_BYTES = 8 * 1024 * 1024; // T6
/** The AI service refuses a single image over 5 MB; the photo is still stored. */
export const MAX_AI_IMAGE_BYTES = 5 * 1024 * 1024;
export const DAILY_SCAN_LIMIT = 200; // T6, per business per London day
const AI_TIMEOUT_MS = 30_000;
const AI_ATTEMPTS = 2; // one try and one retry

const ACCEPTED_MIME = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
} as const;
type AcceptedMime = keyof typeof ACCEPTED_MIME;

const CLIENT_MUTATION_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

export const RECEIPT_SYSTEM_PROMPT =
  'You read UK receipts and invoices for a sole trader (usually a window cleaner or cleaner). ' +
  'Return the shop or supplier name, the date as YYYY-MM-DD (UK dates are day first), the total paid ' +
  'including VAT in pounds, the VAT amount if printed, the line items, and the best category from: ' +
  'vehicle (fuel, parking, van repairs), equipment (tools, poles, ladders, hoses, water-fed kit), ' +
  'supplies (detergent, cloths, squeegee rubbers, resin), phone, insurance, advertising, ' +
  'fees (bank or card charges, GoCardless or Stripe fees), wages, other. ' +
  'Never guess a number you cannot read — use null or an empty string. ' +
  'Set is_receipt false if the picture is not a receipt or invoice. ' +
  'confidence is how sure you are of the total and date together, 0 to 1.';

export type ScanInput = {
  tenantId: string;
  userId: string | null;
  clientMutationId: string; // uuid-ish, 8..64 chars [A-Za-z0-9_-]
  file: { bytes: Uint8Array; mime: string; name?: string };
};

export type ScanResult =
  | {
      ok: true;
      expenseId: string;
      status: 'draft' | 'confirmed';
      read: 'read' | 'unreadable' | 'not_a_receipt';
      replay: boolean;
    }
  | { ok: false; error: 'too_big' | 'wrong_type' | 'daily_limit' | 'storage_failed' | 'save_failed' };

export type ReceiptCall = {
  read: ReceiptRead;
  model: string;
  tokensInput: number;
  tokensOutput: number;
  latencyMs: number;
};

/** Reads one photo with one model. Returns null when it could not be read. */
export type ReceiptReader = (
  model: string,
  file: { bytes: Uint8Array; mime: AcceptedMime },
) => Promise<ReceiptCall | null>;

function isRetryable(e: unknown): boolean {
  if (
    e instanceof Anthropic.RateLimitError ||
    e instanceof Anthropic.APIConnectionError ||
    e instanceof Anthropic.InternalServerError
  ) {
    return true;
  }
  // A 400 the SDK never retries but that usually succeeds moments later.
  return (
    e instanceof Anthropic.APIError &&
    /grammar compilation/i.test(String((e as { message?: unknown }).message ?? ''))
  );
}

/** Real reader: structured output, 30 s timeout, one retry. Never logs the answer. */
export const readReceiptWithModel: ReceiptReader = async (model, file) => {
  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    maxRetries: 0,
  });
  const data = Buffer.from(file.bytes).toString('base64');
  const fileBlock =
    file.mime === 'application/pdf'
      ? ({
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data },
        } as const)
      : ({
          type: 'image',
          source: { type: 'base64', media_type: file.mime, data },
        } as const);
  const effort = supportsEffort(model)
    ? { effort: (model === RECEIPT_ESCALATION_MODEL ? 'medium' : 'low') as 'low' | 'medium' }
    : {};

  for (let attempt = 1; attempt <= AI_ATTEMPTS; attempt += 1) {
    const startedAt = Date.now();
    try {
      const response = await anthropic.messages.parse(
        {
          model,
          max_tokens: 2000,
          system: RECEIPT_SYSTEM_PROMPT,
          messages: [
            {
              role: 'user',
              content: [fileBlock, { type: 'text', text: 'Read this receipt.' }],
            },
          ],
          output_config: { ...effort, format: zodOutputFormat(ReceiptReadSchema) },
        },
        { timeout: AI_TIMEOUT_MS },
      );
      if (response.parsed_output) {
        return {
          read: response.parsed_output,
          model,
          tokensInput: response.usage.input_tokens,
          tokensOutput: response.usage.output_tokens,
          latencyMs: Date.now() - startedAt,
        };
      }
    } catch (e) {
      console.error('[readReceipt] model call failed', {
        model,
        attempt,
        error: e instanceof Error ? e.name : 'unknown',
      });
      if (!isRetryable(e)) return null;
    }
  }
  return null;
};

type ExpenseRow = {
  id: string;
  status: 'draft' | 'confirmed';
  ai_extracted: { is_receipt?: boolean } | null;
};

function replayResult(row: ExpenseRow): ScanResult {
  return {
    ok: true,
    expenseId: row.id,
    status: row.status,
    read: row.ai_extracted == null ? 'unreadable' : row.ai_extracted.is_receipt === false ? 'not_a_receipt' : 'read',
    replay: true,
  };
}

async function findByClientMutationId(
  admin: SupabaseClient,
  tenantId: string,
  clientMutationId: string,
): Promise<ExpenseRow | null> {
  const { data } = await admin
    .from('expenses')
    .select('id, status, ai_extracted')
    .eq('tenant_id', tenantId)
    .eq('client_mutation_id', clientMutationId)
    .maybeSingle();
  return (data as ExpenseRow | null) ?? null;
}

async function removeObject(admin: SupabaseClient, path: string): Promise<void> {
  try {
    const { error } = await admin.storage.from(RECEIPT_BUCKET).remove([path]);
    if (error) console.error('[scanReceiptCore] could not remove stored photo', { path });
  } catch {
    console.error('[scanReceiptCore] could not remove stored photo', { path });
  }
}

/**
 * Store the photo, make a To check draft, read it (Haiku, then Sonnet when
 * unsure). D3: never confirms. T3: a failed read leaves a blank draft with the
 * photo. T4: the same clientMutationId returns the existing row without a
 * second photo or AI call.
 *
 * `reader` is only for tests.
 */
export async function scanReceiptCore(
  admin: SupabaseClient,
  input: ScanInput,
  reader: ReceiptReader = readReceiptWithModel,
): Promise<ScanResult> {
  const { tenantId, userId, clientMutationId, file } = input;

  // 1. Type and size.
  if (!Object.hasOwn(ACCEPTED_MIME, file.mime)) return { ok: false, error: 'wrong_type' };
  const mime = file.mime as AcceptedMime;
  if (file.bytes.length > MAX_RECEIPT_BYTES) return { ok: false, error: 'too_big' };
  if (!CLIENT_MUTATION_ID_RE.test(clientMutationId)) return { ok: false, error: 'save_failed' };

  // 2. Replay: the phone may retry after a timeout that actually worked.
  const existing = await findByClientMutationId(admin, tenantId, clientMutationId);
  if (existing) return replayResult(existing);

  // 3. Daily limit. If we cannot count, fail safe rather than scan unlimited.
  const { startIso } = londonDayBoundsUtc(todayInLondon());
  const { count, error: countError } = await admin
    .from('expenses')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('source', 'receipt_scan')
    .gte('created_at', startIso);
  if (countError || count == null) return { ok: false, error: 'save_failed' };
  if (count >= DAILY_SCAN_LIMIT) return { ok: false, error: 'daily_limit' };

  // 4. Photo first, so it is never lost.
  const expenseId = crypto.randomUUID();
  const receiptPath = `${tenantId}/${expenseId}.${ACCEPTED_MIME[mime]}`;
  const { error: uploadError } = await admin.storage
    .from(RECEIPT_BUCKET)
    .upload(receiptPath, file.bytes, { contentType: mime, upsert: false });
  if (uploadError) return { ok: false, error: 'storage_failed' };

  // 5. The draft row.
  const { error: insertError } = await admin.from('expenses').insert({
    id: expenseId,
    tenant_id: tenantId,
    status: 'draft',
    source: 'receipt_scan',
    receipt_path: receiptPath,
    receipt_mime: mime,
    client_mutation_id: clientMutationId,
    created_by_user_id: userId,
  });
  if (insertError) {
    // Our path holds our own random id, so this never touches a winner's photo.
    await removeObject(admin, receiptPath);
    if (insertError.code === '23505') {
      const winner = await findByClientMutationId(admin, tenantId, clientMutationId);
      return winner ? replayResult(winner) : { ok: false, error: 'save_failed' };
    }
    return { ok: false, error: 'save_failed' };
  }

  // 6. Read it. Any failure here leaves the blank draft and the photo.
  let kept: ReceiptCall | null = null;
  try {
    const aiFile = { bytes: file.bytes, mime };
    const tooBigForAi = mime !== 'application/pdf' && file.bytes.length > MAX_AI_IMAGE_BYTES;
    if (!tooBigForAi) {
      kept = await reader(RECEIPT_AI_MODEL, aiFile);
      if (kept) await logCall(admin, tenantId, expenseId, mime, file.bytes.length, kept);
      // Same model both times would only repeat itself, so there is no second read.
      if (kept && RECEIPT_ESCALATION_MODEL !== RECEIPT_AI_MODEL && needsEscalation(kept.read)) {
        const second = await reader(RECEIPT_ESCALATION_MODEL, aiFile);
        if (second) {
          await logCall(admin, tenantId, expenseId, mime, file.bytes.length, second);
          kept = second;
        }
      }
    }
  } catch (e) {
    console.error('[scanReceiptCore] read failed', {
      expenseId,
      error: e instanceof Error ? e.name : 'unknown',
    });
    kept = null;
  }
  if (!kept) {
    return { ok: true, expenseId, status: 'draft', read: 'unreadable', replay: false };
  }

  // 7. Fill the draft — only while it is still a draft (D3: never confirm).
  const notAReceipt = !kept.read.is_receipt;
  const fields = notAReceipt ? {} : toDraftFields(kept.read, todayInLondon());
  const { error: updateError } = await admin
    .from('expenses')
    .update({ ...fields, ai_extracted: kept.read, ai_model: kept.model })
    .eq('id', expenseId)
    .eq('tenant_id', tenantId)
    .eq('status', 'draft');
  if (updateError) {
    console.error('[scanReceiptCore] could not fill the draft', { expenseId });
    return { ok: true, expenseId, status: 'draft', read: 'unreadable', replay: false };
  }

  return {
    ok: true,
    expenseId,
    status: 'draft',
    read: notAReceipt ? 'not_a_receipt' : 'read',
    replay: false,
  };
}

async function logCall(
  admin: SupabaseClient,
  tenantId: string,
  expenseId: string,
  mime: string,
  bytes: number,
  call: ReceiptCall,
): Promise<void> {
  try {
    await logStructuredAiInteraction(admin, {
      tenantId,
      interactionType: 'receipt_extraction',
      prompt: RECEIPT_SYSTEM_PROMPT,
      inputData: { expenseId, mime, bytes }, // never the image
      parsedOutput: call.read,
      model: call.model,
      tokensInput: call.tokensInput,
      tokensOutput: call.tokensOutput,
      latencyMs: call.latencyMs,
    });
  } catch {
    console.error('[scanReceiptCore] could not log the AI call', { expenseId });
  }
}
