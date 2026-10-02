'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getTenantIdForCurrentUser } from '@/lib/data/tenant';
import { getTenantProducts } from '@/lib/data/tenant-products';
import { isTenantAdmin } from '@/lib/stripe/connect';
import { logStructuredAiInteraction } from '@/lib/services/ai-interaction-log';
import { londonDayBoundsUtc, todayInLondon } from '@/lib/rounds/dates';
import { ROUND_BOOK_AI_MODEL } from '@/lib/ai/model';
import {
  readPageWithAi,
  readRoundBookCore,
  ROUND_BOOK_ERRORS,
  validateRoundBookInput,
  type RoundBookInput,
  type RoundBookResult,
} from '@/lib/import/round-book-core';

/**
 * Photos of a round book (one or more) or typed notes → the same extracted
 * customer rows as the spreadsheet reader. Nothing is stored: the photos and
 * text exist only for the length of this call. The dashboard sends photos one
 * per call (a request body tops out near 5 MB) and joins the results.
 */
export async function readRoundBook(formData: FormData): Promise<RoundBookResult> {
  const tenantId = await getTenantIdForCurrentUser();
  if (!tenantId) return { success: false, error: 'Not signed in' };

  const products = await getTenantProducts();
  if (!products.hasRounds) return { success: false, error: ROUND_BOOK_ERRORS.notRounds };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) return { success: false, error: 'Not signed in' };
  if (!(await isTenantAdmin(supabase, user.id))) {
    return { success: false, error: ROUND_BOOK_ERRORS.notOwner };
  }

  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    return { success: false, error: ROUND_BOOK_ERRORS.failed };
  }

  const kind = formData.get('kind');
  let input: RoundBookInput;
  if (kind === 'text') {
    const text = formData.get('text');
    input = { kind: 'text', text: typeof text === 'string' ? text : '' };
  } else if (kind === 'photos') {
    const files = formData.getAll('file').filter((f): f is File => f instanceof File);
    input = {
      kind: 'photos',
      files: await Promise.all(
        files.map(async (f) => ({
          bytes: new Uint8Array(await f.arrayBuffer()),
          mime: f.type,
          name: f.name,
        }))
      ),
    };
  } else {
    return { success: false, error: ROUND_BOOK_ERRORS.failed };
  }

  // Cost guard: photo reads today. If we cannot count, refuse rather than read unlimited.
  let photoReadsToday = 0;
  if (input.kind === 'photos') {
    const { startIso } = londonDayBoundsUtc(todayInLondon());
    const { count, error } = await createAdminClient()
      .from('ai_interactions')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('interaction_type', 'customer_row_extraction')
      .eq('input_data->>kind', 'photos')
      .gte('created_at', startIso);
    if (error || count == null) return { success: false, error: ROUND_BOOK_ERRORS.failed };
    photoReadsToday = count;
  }

  const invalid = validateRoundBookInput(input, photoReadsToday);
  if (invalid) return { success: false, error: invalid };

  return readRoundBookCore({
    input,
    readPage: readPageWithAi,
    log: (entry) =>
      logStructuredAiInteraction(supabase, {
        tenantId,
        interactionType: 'customer_row_extraction',
        prompt: 'round_book_reading (contents not logged)',
        inputData: { kind: entry.kind, page: entry.page, bytes: entry.bytes },
        parsedOutput: { row_count: entry.rows },
        model: ROUND_BOOK_AI_MODEL,
        tokensInput: entry.tokensInput,
        tokensOutput: entry.tokensOutput,
        latencyMs: entry.latencyMs,
      }),
  });
}
