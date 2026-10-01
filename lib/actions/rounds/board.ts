'use server';

import { getTenantIdForCurrentUser } from '@/lib/data/tenant';
import { getTenantProducts } from '@/lib/data/tenant-products';
import { createClient } from '@/lib/supabase/server';
import { getVisitsForRange, type VisitRow } from '@/lib/data/rounds/visits';
import { isValidYmd, todayInLondon, type Ymd } from '@/lib/rounds/dates';
import { listUntoldMoves, type UntoldMove } from '@/lib/rounds/visit-changes';
import {
  BOARD_LOAD_STEP_WEEKS,
  mondayOf,
  rangeEnd,
} from '@/lib/rounds/week-board';

/**
 * More weeks for the Week board as you scroll towards either end. The tenant always comes
 * from the signed-in user, never from the browser.
 */
export async function loadBoardWeeks(input: {
  from: string;
  weeks: number;
}): Promise<
  | { success: true; visits: VisitRow[]; from: Ymd; to: Ymd }
  | { success: false; error: string }
> {
  const tenantId = await getTenantIdForCurrentUser();
  if (!tenantId) return { success: false, error: 'Not authenticated' };
  const products = await getTenantProducts();
  if (!products.hasRounds) return { success: false, error: 'Not available' };

  if (!isValidYmd(input.from)) return { success: false, error: 'Invalid date' };
  const weeks = input.weeks;
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > BOARD_LOAD_STEP_WEEKS * 2) {
    return { success: false, error: 'Pick fewer weeks at a time.' };
  }

  const from = mondayOf(input.from);
  const to = rangeEnd({ from, weeks });
  const result = await getVisitsForRange(tenantId, from, to);
  if (result.error) return { success: false, error: 'Could not load those weeks. Try again.' };
  return { success: true, visits: result.visits, from, to };
}

/** Moves customers haven't been told about, for the "Not told" tag. Empty on any trouble: the tag is a hint, not a gate. */
export async function loadUntoldMoves(): Promise<UntoldMove[]> {
  const tenantId = await getTenantIdForCurrentUser();
  if (!tenantId) return [];
  const products = await getTenantProducts();
  if (!products.hasRounds) return [];
  const supabase = await createClient();
  return (await listUntoldMoves(supabase, tenantId, { today: todayInLondon() })) ?? [];
}
