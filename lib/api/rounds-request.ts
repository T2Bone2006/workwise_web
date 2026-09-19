import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { createClientFromBearer, resolveTenantForUser } from '@/lib/auth/bearer';
import type { Actor } from '@/lib/rounds/visit-transitions';

export type RoundsApiContext = {
  supabase: SupabaseClient;
  userId: string;
  tenantId: string;
};

export async function requireRoundsApi(
  request: Request,
): Promise<{ ok: true; ctx: RoundsApiContext } | { ok: false; response: NextResponse }> {
  const auth = await createClientFromBearer(request);
  if (!auth) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Unauthorised' }, { status: 401 }),
    };
  }

  const tenantId = await resolveTenantForUser(auth.supabase, auth.userId);
  if (!tenantId) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    };
  }

  return { ok: true, ctx: { ...auth, tenantId } };
}

export async function actorForUser(
  supabase: SupabaseClient,
  userId: string,
): Promise<Actor> {
  const { data } = await supabase
    .from('workers')
    .select('id')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle();
  return {
    userId,
    workerId: typeof data?.id === 'string' ? data.id : undefined,
  };
}

export async function readJsonBody(
  request: Request,
): Promise<
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; response: NextResponse }
> {
  try {
    const body = await request.json();
    if (body == null || typeof body !== 'object' || Array.isArray(body)) {
      return {
        ok: false,
        response: NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }),
      };
    }
    return { ok: true, body: body as Record<string, unknown> };
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }),
    };
  }
}

export function firstZodError(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Invalid input';
}

export function emptyToNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}
