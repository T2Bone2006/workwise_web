import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { ENTITLED_STATUSES } from '@/lib/data/tenant-products';
import { formatUkPhoneDisplay } from '@/lib/utils/phone';
import { devLocalhostAllowed, hostFromOrigin, isAllowedHost } from '@/lib/widget/origin';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const WIDGET_COLUMNS =
  'id, tenant_id, business_name, trade, service_area, business_context, greeting, primary_colour, allowed_domains, owner_mobile_e164, sign_off_name, follow_up_enabled, text_me_too, notification_email';

export type WidgetRow = {
  id: string;
  tenant_id: string;
  business_name: string;
  trade: string;
  service_area: string;
  business_context: string;
  greeting: string;
  primary_colour: string;
  allowed_domains: string[];
  owner_mobile_e164: string | null;
  sign_off_name: string | null;
  follow_up_enabled: boolean;
  text_me_too: boolean;
  notification_email: string;
};

export type GuardOk = { ok: true; widget: WidgetRow; originHost: string; cors: Record<string, string> };
export type GuardFail = { ok: false; response: Response };

function sessionSecret(): string | null {
  const secret = process.env.WIDGET_SESSION_SECRET?.trim();
  return secret ? secret : null;
}

function inactive(status: number): GuardFail {
  return { ok: false, response: Response.json({ active: false }, { status }) };
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asWidget(row: unknown): WidgetRow | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  const id = asString(r.id);
  const tenantId = asString(r.tenant_id);
  const businessName = asString(r.business_name);
  const trade = asString(r.trade);
  const serviceArea = asString(r.service_area);
  const businessContext = asString(r.business_context);
  const greeting = asString(r.greeting);
  const primaryColour = asString(r.primary_colour);
  const notificationEmail = asString(r.notification_email);
  if (
    !id ||
    !tenantId ||
    businessName == null ||
    trade == null ||
    serviceArea == null ||
    businessContext == null ||
    greeting == null ||
    primaryColour == null ||
    notificationEmail == null
  ) {
    return null;
  }
  if (typeof r.follow_up_enabled !== 'boolean' || typeof r.text_me_too !== 'boolean') return null;
  if (r.sign_off_name != null && typeof r.sign_off_name !== 'string') return null;
  if (r.owner_mobile_e164 != null && typeof r.owner_mobile_e164 !== 'string') return null;
  if (!Array.isArray(r.allowed_domains) || r.allowed_domains.some((d) => typeof d !== 'string')) return null;

  return {
    id,
    tenant_id: tenantId,
    business_name: businessName,
    trade,
    service_area: serviceArea,
    business_context: businessContext,
    greeting,
    primary_colour: primaryColour,
    allowed_domains: r.allowed_domains as string[],
    owner_mobile_e164: (r.owner_mobile_e164 as string | null) ?? null,
    sign_off_name: (r.sign_off_name as string | null) ?? null,
    follow_up_enabled: r.follow_up_enabled,
    text_me_too: r.text_me_too,
    notification_email: notificationEmail,
  };
}

export async function guardWidgetRequest(
  admin: SupabaseClient,
  request: Request,
  clientId: string,
  opts: { methods: 'GET, OPTIONS' | 'POST, OPTIONS' },
): Promise<GuardOk | GuardFail> {
  if (!UUID_RE.test(clientId)) return inactive(404);

  if (!sessionSecret()) {
    console.error('[widget] WIDGET_SESSION_SECRET is not set');
    return inactive(503);
  }

  let widget: WidgetRow | null = null;
  try {
    const { data, error } = await admin
      .from('widget_clients')
      .select(WIDGET_COLUMNS)
      .eq('id', clientId)
      .eq('active', true)
      .not('tenant_id', 'is', null)
      .maybeSingle();
    if (error || !data) return inactive(404);
    widget = asWidget(data);
  } catch {
    return inactive(404);
  }
  if (!widget) return inactive(404);

  try {
    const { data, error } = await admin
      .from('subscriptions')
      .select('id')
      .eq('tenant_id', widget.tenant_id)
      .eq('product', 'lite')
      .in('status', [...ENTITLED_STATUSES])
      .limit(1);
    if (error || !data || data.length === 0) {
      if (error) console.error('[widget] lite entitlement check failed');
      return inactive(404);
    }
  } catch {
    return inactive(404);
  }

  const originHeader = request.headers.get('origin');
  const originHost = hostFromOrigin(originHeader);
  // A same-origin GET (the laptop test page) sends no Origin. Only localhost, and only with the flag.
  const pageHost = hostFromOrigin(request.url);
  const host = originHost ?? (devLocalhostAllowed(pageHost) ? pageHost : null);
  if (!host || (!isAllowedHost(host, widget.allowed_domains) && !devLocalhostAllowed(host))) {
    return inactive(403);
  }

  const cors: Record<string, string> = { Vary: 'Origin' };
  if (originHeader && originHost) {
    cors['Access-Control-Allow-Origin'] = originHeader;
    cors['Access-Control-Allow-Methods'] = opts.methods;
    cors['Access-Control-Allow-Headers'] = 'Content-Type';
  }

  return {
    ok: true,
    widget,
    originHost: host,
    cors,
  };
}

/** 204. CORS only if the origin parses; the real website check happens on the real request. */
export function preflightResponse(request: Request, methods: string): Response {
  const origin = request.headers.get('origin');
  const headers = new Headers();
  if (origin && hostFromOrigin(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Vary', 'Origin');
    headers.set('Access-Control-Allow-Methods', methods);
    headers.set('Access-Control-Allow-Headers', 'Content-Type');
  }
  return new Response(null, { status: 204, headers });
}

export function limitedResponse(cors: Record<string, string>, mobile: string | null): Response {
  const national = formatUkPhoneDisplay(mobile);
  const message = national
    ? `Sorry, I can't take more messages right now — please call ${national} instead.`
    : `Sorry, I can't take more messages right now — please try again later.`;
  return Response.json({ limited: true, message }, { status: 429, headers: cors });
}
