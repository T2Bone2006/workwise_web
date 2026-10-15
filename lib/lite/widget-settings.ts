import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { readAllPages } from '@/lib/data/read-all-pages';
import type { LiteContext } from '@/lib/lite/require-lite';
import { getSetupStatus } from '@/lib/lite/setup-status';
import { normaliseWebsite } from '@/lib/widget/origin';
import { formatUkPhoneDisplay, normalizeUkPhoneE164 } from '@/lib/utils/phone';
import { widgetTextsSchema, type WidgetLookValues, type WidgetTextsValues } from '@/lib/validations/lite/widget';

const MOBILE_RE = /^\+447\d{9}$/;
const COLOUR_RE = /^#[0-9a-fA-F]{6}$/;

const WEBSITE_ERROR = "That doesn't look like a website address \u2014 try something like daveplastering.co.uk";
const MOBILE_ERROR = 'Please enter a UK mobile number.';
const TEXT_ME_ERROR = 'Add your mobile first.';
const EMAIL_ERROR = 'Please check the email address.';
const SAVE_ERROR = "Couldn't save that. Try again.";
const CLEARED_NOTE = "Text me too was switched off because there's no mobile.";

export type WidgetSettingsView = {
  id: string;
  active: boolean;
  website: string | null;
  primaryColour: string;
  greeting: string;
  signOffName: string;
  ownerMobileDisplay: string;
  followUpEnabled: boolean;
  textMeToo: boolean;
  notificationEmail: string;
  setupLive: boolean;
  /** A visitor opened the chat on the saved website in the last 7 days. */
  seenOnWebsite: boolean;
  last7Days: { chats: number; leads: number };
};

const DEFAULT_GREETING = 'Hi! What type of job do you need help with today?';
const DEFAULT_COLOUR = '#0C66E4';

type Saved = { ok: true } | { ok: false; error: string };

async function writeWidget(
  admin: SupabaseClient,
  ctx: LiteContext,
  patch: Record<string, unknown>,
): Promise<Saved> {
  const { data, error } = await admin
    .from('widget_clients')
    .update(patch)
    .eq('id', ctx.widget.id)
    .eq('tenant_id', ctx.tenantId)
    .select('id');
  if (error || !Array.isArray(data) || data.length === 0) return { ok: false, error: SAVE_ERROR };
  return { ok: true };
}

/** One website. The stored host has no scheme, path or www. */
export async function saveWidgetWebsite(
  admin: SupabaseClient,
  ctx: LiteContext,
  website: string,
): Promise<{ ok: true; host: string } | { ok: false; error: string }> {
  const host = normaliseWebsite(website);
  if (!host) return { ok: false, error: WEBSITE_ERROR };
  const saved = await writeWidget(admin, ctx, { allowed_domains: [host], website_url: host });
  if (!saved.ok) return saved;
  return { ok: true, host };
}

export async function saveWidgetLook(
  admin: SupabaseClient,
  ctx: LiteContext,
  v: WidgetLookValues,
): Promise<Saved> {
  if (!COLOUR_RE.test(v.primaryColour)) return { ok: false, error: 'Pick a colour like #0C66E4.' };
  const greeting = v.greeting.trim();
  if (greeting.length < 5 || greeting.length > 200) {
    return { ok: false, error: 'Write a greeting between 5 and 200 characters.' };
  }
  return writeWidget(admin, ctx, { primary_colour: v.primaryColour, greeting });
}

export async function saveWidgetTexts(
  admin: SupabaseClient,
  ctx: LiteContext,
  v: WidgetTextsValues,
): Promise<{ ok: true; note?: string } | { ok: false; field?: keyof WidgetTextsValues; error: string }> {
  const parsed = widgetTextsSchema.safeParse(v);
  if (!parsed.success) {
    const path = parsed.error.issues[0]?.path[0];
    if (path === 'notificationEmail') return { ok: false, field: 'notificationEmail', error: EMAIL_ERROR };
    if (path === 'ownerMobile') return { ok: false, field: 'ownerMobile', error: MOBILE_ERROR };
    if (path === 'signOffName') return { ok: false, field: 'signOffName', error: 'Add the name to sign texts with.' };
    return { ok: false, error: SAVE_ERROR };
  }

  const rawMobile = parsed.data.ownerMobile?.trim() ?? '';
  let mobile: string | null = null;
  if (rawMobile !== '') {
    const e164 = normalizeUkPhoneE164(rawMobile);
    if (!e164 || !MOBILE_RE.test(e164)) return { ok: false, field: 'ownerMobile', error: MOBILE_ERROR };
    mobile = e164;
  }

  let textMeToo = parsed.data.textMeToo;
  let note: string | undefined;
  if (textMeToo && !mobile) {
    const { data, error } = await admin
      .from('widget_clients')
      .select('owner_mobile_e164, text_me_too')
      .eq('id', ctx.widget.id)
      .eq('tenant_id', ctx.tenantId)
      .maybeSingle();
    if (error || !data) return { ok: false, error: SAVE_ERROR };
    const row = data as { owner_mobile_e164?: unknown; text_me_too?: unknown };
    const hadMobile = typeof row.owner_mobile_e164 === 'string' && row.owner_mobile_e164 !== '';
    const wasOn = row.text_me_too === true;
    if (wasOn || hadMobile) {
      textMeToo = false;
      note = CLEARED_NOTE;
    } else {
      return { ok: false, field: 'textMeToo', error: TEXT_ME_ERROR };
    }
  }

  const saved = await writeWidget(admin, ctx, {
    sign_off_name: parsed.data.signOffName,
    owner_mobile_e164: mobile,
    follow_up_enabled: parsed.data.followUpEnabled,
    text_me_too: textMeToo,
    notification_email: parsed.data.notificationEmail,
  });
  if (!saved.ok) return saved;
  return note ? { ok: true, note } : { ok: true };
}

export async function setWidgetActive(
  admin: SupabaseClient,
  ctx: LiteContext,
  active: boolean,
): Promise<Saved> {
  if (typeof active !== 'boolean') return { ok: false, error: SAVE_ERROR };
  return writeWidget(admin, ctx, { active });
}

function seenOnSite(website: string | null, rows: Record<string, unknown>[]): boolean {
  if (!website) return false;
  const site = website.toLowerCase();
  return rows.some((row) => {
    const host = typeof row.origin_host === 'string' ? row.origin_host.trim().toLowerCase() : '';
    return host === site || host === `www.${site}`;
  });
}

function asHost(row: Record<string, unknown>): string | null {
  const url = typeof row.website_url === 'string' ? row.website_url.trim() : '';
  if (url) return url;
  const domains = Array.isArray(row.allowed_domains)
    ? row.allowed_domains.filter((domain): domain is string => typeof domain === 'string' && domain.trim() !== '')
    : [];
  return domains[0]?.trim() ?? null;
}

export async function getWidgetSettings(admin: SupabaseClient, ctx: LiteContext): Promise<WidgetSettingsView> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const [widgetResult, setup, chatRows, leadRows] = await Promise.all([
    admin
      .from('widget_clients')
      .select(
        'id, active, website_url, allowed_domains, primary_colour, greeting, sign_off_name, owner_mobile_e164, follow_up_enabled, text_me_too, notification_email',
      )
      .eq('id', ctx.widget.id)
      .eq('tenant_id', ctx.tenantId)
      .maybeSingle(),
    getSetupStatus(admin, ctx.tenantId),
    readAllPages(
      (from, to) =>
        admin
          .from('widget_conversations')
          .select('id, origin_host')
          .eq('tenant_id', ctx.tenantId)
          .gte('created_at', since)
          .order('id', { ascending: true })
          .range(from, to),
      'Could not load widget settings',
    ).catch(() => [] as Record<string, unknown>[]),
    readAllPages(
      (from, to) =>
        admin
          .from('leads')
          .select('widget_conversation_id')
          .eq('tenant_id', ctx.tenantId)
          .order('id', { ascending: true })
          .range(from, to),
      'Could not load widget settings',
    ).catch(() => [] as Record<string, unknown>[]),
  ]);

  if (widgetResult.error || !widgetResult.data) throw new Error('Could not load widget settings');
  const row = widgetResult.data as Record<string, unknown>;
  const chatIds = new Set(
    chatRows.map((chat) => (typeof chat.id === 'string' ? chat.id : null)).filter((id): id is string => id != null),
  );
  let leads = 0;
  for (const lead of leadRows) {
    const id = typeof lead.widget_conversation_id === 'string' ? lead.widget_conversation_id : null;
    if (id && chatIds.has(id)) leads += 1;
  }
  const website = asHost(row);
  const colour = typeof row.primary_colour === 'string' && COLOUR_RE.test(row.primary_colour) ? row.primary_colour : DEFAULT_COLOUR;
  const greeting = typeof row.greeting === 'string' && row.greeting.trim() !== '' ? row.greeting : DEFAULT_GREETING;
  const mobile = typeof row.owner_mobile_e164 === 'string' ? row.owner_mobile_e164 : null;

  return {
    id: ctx.widget.id,
    active: row.active !== false,
    website,
    seenOnWebsite: seenOnSite(website, chatRows),
    primaryColour: colour,
    greeting,
    signOffName: typeof row.sign_off_name === 'string' ? row.sign_off_name : '',
    ownerMobileDisplay: formatUkPhoneDisplay(mobile),
    followUpEnabled: row.follow_up_enabled !== false,
    textMeToo: row.text_me_too === true,
    notificationEmail: typeof row.notification_email === 'string' ? row.notification_email : '',
    setupLive: setup.state === 'live',
    last7Days: { chats: chatIds.size, leads },
  };
}
