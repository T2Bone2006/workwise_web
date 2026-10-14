import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

/** The 403 body every owner-only route gives a member of staff. The phone reads this exact string. */
export const OWNER_ONLY_ERROR = 'owner_only';

/**
 * True only when the caller's users row exists and its role is 'admin'. A missing row, a read error or any
 * throw is false: a Rounds member of staff is a users row with role 'worker', so "can't tell" must mean "not the owner".
 */
export async function callerIsOwner(supabase: SupabaseClient, userId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase.from('users').select('role').eq('id', userId).maybeSingle();
    if (error) return false;
    return (data as { role?: unknown } | null)?.role === 'admin';
  } catch {
    return false;
  }
}

export function ownerOnlyResponse(): NextResponse {
  return NextResponse.json(
    { error: OWNER_ONLY_ERROR },
    { status: 403, headers: { 'Cache-Control': 'no-store' } },
  );
}
