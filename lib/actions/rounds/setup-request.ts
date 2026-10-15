'use server';

import { requireAdminRounds } from '@/lib/auth/require-admin-rounds';
import { sendSetupRequestEmail, type SetupRequestContext } from '@/lib/emails/setup-request';
import { createAdminClient } from '@/lib/supabase/admin';

const BUCKET = 'setup-requests';
const SIGNED_URL_SECONDS = 7 * 24 * 60 * 60;
const MAX_FILES = 5;
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_NOTE = 2000;
const WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

const SEND_FAIL = "Couldn't send that. Try again.";
const ALREADY = "We're already working on your last request — we'll be in touch.";
const NEED_SOMETHING = 'Add a file or tell us what you need.';

const MIME_BY_EXT: Record<string, string> = {
  csv: 'text/csv',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  txt: 'text/plain',
};

type Admin = ReturnType<typeof createAdminClient>;

function displayName(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? 'that file';
  const clean = base.replace(/[\u0000-\u001f]/g, '').trim();
  return (clean || 'that file').slice(0, 80);
}

function extensionOf(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return '';
  return base.slice(dot + 1).toLowerCase();
}

/** Letters, numbers, dot, hyphen, underscore. Duplicates get -2, -3, … Max 80 characters. */
function safeSetupFileName(original: string, used: Set<string>): string {
  const base = (original.split(/[/\\]/).pop() ?? 'file').replace(/[^A-Za-z0-9._-]/g, '');
  const dot = base.lastIndexOf('.');
  let ext = '';
  let stem = base;
  if (dot > 0) {
    ext = base.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '');
    stem = base.slice(0, dot);
  }
  if (!stem.replace(/\./g, '')) stem = 'file';
  const suffix = ext ? `.${ext}` : '';
  const room = Math.max(1, 80 - suffix.length);
  stem = stem.slice(0, room);
  const name = `${stem}${suffix}`.slice(0, 80);
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  let n = 2;
  let candidate = name;
  while (used.has(candidate) && n < 100) {
    const tag = `-${n}`;
    const stemRoom = Math.max(1, 80 - suffix.length - tag.length);
    candidate = `${stem.slice(0, stemRoom)}${tag}${suffix}`.slice(0, 80);
    n += 1;
  }
  used.add(candidate);
  return candidate;
}

function traderPhone(settings: unknown): string | null {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return null;
  const record = settings as {
    company?: { phone?: unknown };
    messaging?: { contact_phone?: unknown };
  };
  const contact = record.messaging?.contact_phone;
  if (typeof contact === 'string' && contact.trim()) return contact.trim();
  const phone = record.company?.phone;
  if (typeof phone === 'string' && phone.trim()) return phone.trim();
  return null;
}

function asContext(value: FormDataEntryValue | null): SetupRequestContext | null {
  if (value === 'review' || value === 'read_failed' || value === 'done') return value;
  return null;
}

async function abandon(admin: Admin, tenantId: string, requestId: string, paths: string[]): Promise<void> {
  if (paths.length > 0) {
    try {
      const { error } = await admin.storage.from(BUCKET).remove(paths);
      if (error) console.error('[sendSetupRequest] could not remove files');
    } catch {
      console.error('[sendSetupRequest] could not remove files');
    }
  }
  try {
    const { error } = await admin.from('setup_requests').delete().eq('id', requestId).eq('tenant_id', tenantId);
    if (error) console.error('[sendSetupRequest] could not remove the request');
  } catch {
    console.error('[sendSetupRequest] could not remove the request');
  }
}

export async function sendSetupRequest(
  formData: FormData,
): Promise<{ success: true } | { success: false; error: string }> {
  const ctx = await requireAdminRounds('Import is part of Rounds.');
  if (!ctx.success) return ctx;

  const noteRaw = formData.get('note');
  const note = typeof noteRaw === 'string' ? noteRaw.trim() : '';
  if (note.length > MAX_NOTE) {
    return { success: false, error: 'Keep the note to 2000 characters.' };
  }
  const context = asContext(formData.get('context'));
  if (!context) return { success: false, error: SEND_FAIL };

  const realFiles = formData.getAll('file').filter((value): value is File => value instanceof File);
  if (realFiles.length === 0 && note.length === 0) {
    return { success: false, error: NEED_SOMETHING };
  }
  if (realFiles.length > MAX_FILES) {
    return { success: false, error: 'You can send up to 5 files.' };
  }
  for (const file of realFiles) {
    const name = displayName(file.name);
    if (!MIME_BY_EXT[extensionOf(file.name)]) {
      return { success: false, error: `${name} needs to be a spreadsheet, PDF, photo or text file.` };
    }
    if (file.size > MAX_BYTES) {
      return { success: false, error: `${name} is over 10 MB.` };
    }
  }

  const admin = createAdminClient();
  const since = new Date(Date.now() - WINDOW_MS).toISOString();
  const { count, error: countError } = await admin
    .from('setup_requests')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', ctx.tenantId)
    .eq('status', 'open')
    .gte('created_at', since);
  if (countError || count == null) {
    console.error('[sendSetupRequest] could not check existing requests');
    return { success: false, error: SEND_FAIL };
  }
  if (count > 0) return { success: false, error: ALREADY };

  const to = process.env.SETUP_REQUEST_EMAIL?.trim();
  if (!to) {
    console.error('SETUP_REQUEST_EMAIL not set');
    return { success: false, error: SEND_FAIL };
  }

  let businessName = 'A business';
  let traderName: string | null = null;
  let traderEmail: string | null = null;
  let traderPhoneValue: string | null = null;
  try {
    const { data: auth } = await ctx.supabase.auth.getUser();
    const loginEmail = auth.user?.email?.trim() || null;
    const { data: userRow } = await admin
      .from('users')
      .select('full_name, email')
      .eq('id', ctx.userId)
      .maybeSingle();
    const user = userRow as { full_name?: string | null; email?: string | null } | null;
    traderName = user?.full_name?.trim() || null;
    traderEmail = loginEmail || user?.email?.trim() || null;
    const { data: tenantRow } = await admin
      .from('tenants')
      .select('name, settings')
      .eq('id', ctx.tenantId)
      .maybeSingle();
    const tenant = tenantRow as { name?: string | null; settings?: unknown } | null;
    if (tenant?.name?.trim()) businessName = tenant.name.trim();
    traderPhoneValue = traderPhone(tenant?.settings);
  } catch {
    console.error('[sendSetupRequest] could not read the business');
  }

  const { data: inserted, error: insertError } = await admin
    .from('setup_requests')
    .insert({
      tenant_id: ctx.tenantId,
      requested_by_user_id: ctx.userId,
      note: note.length > 0 ? note : null,
      file_paths: [],
      status: 'open',
    })
    .select('id')
    .single();
  const requestId = (inserted as { id?: string } | null)?.id;
  if (insertError || !requestId) {
    console.error('[sendSetupRequest] could not save the request');
    return { success: false, error: SEND_FAIL };
  }

  // Two sends at once can both pass the first check. If this row is no longer the only open one, drop it and don't email.
  const { count: openNow, error: openError } = await admin
    .from('setup_requests')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', ctx.tenantId)
    .eq('status', 'open')
    .gte('created_at', since);
  if (openError || openNow == null) {
    await abandon(admin, ctx.tenantId, requestId, []);
    return { success: false, error: SEND_FAIL };
  }
  if (openNow > 1) {
    await abandon(admin, ctx.tenantId, requestId, []);
    return { success: false, error: ALREADY };
  }

  const uploaded: string[] = [];
  const links: { name: string; bytes: number; url: string }[] = [];
  const used = new Set<string>();
  for (const file of realFiles) {
    const safe = safeSetupFileName(file.name, used);
    const path = `${ctx.tenantId}/${requestId}/${safe}`;
    const mime = MIME_BY_EXT[extensionOf(file.name)]!;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const { error: uploadError } = await admin.storage.from(BUCKET).upload(path, bytes, {
        contentType: mime,
        upsert: false,
      });
      if (uploadError) {
        await abandon(admin, ctx.tenantId, requestId, uploaded);
        return { success: false, error: `Couldn't upload ${displayName(file.name)}. Try again.` };
      }
    } catch {
      await abandon(admin, ctx.tenantId, requestId, uploaded);
      return { success: false, error: `Couldn't upload ${displayName(file.name)}. Try again.` };
    }
    uploaded.push(path);
    links.push({ name: displayName(file.name), bytes: file.size, url: '' });
  }

  const { error: pathsError } = await admin
    .from('setup_requests')
    .update({ file_paths: uploaded })
    .eq('id', requestId)
    .eq('tenant_id', ctx.tenantId);
  if (pathsError) {
    await abandon(admin, ctx.tenantId, requestId, uploaded);
    return { success: false, error: SEND_FAIL };
  }

  for (let i = 0; i < uploaded.length; i += 1) {
    const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(uploaded[i]!, SIGNED_URL_SECONDS);
    const url = data?.signedUrl;
    if (error || !url) {
      await abandon(admin, ctx.tenantId, requestId, uploaded);
      return { success: false, error: SEND_FAIL };
    }
    links[i] = { ...links[i]!, url };
  }

  const sent = await sendSetupRequestEmail({
    to,
    replyTo: traderEmail,
    businessName,
    tenantId: ctx.tenantId,
    traderName,
    traderEmail,
    traderPhone: traderPhoneValue,
    note: note.length > 0 ? note : null,
    context,
    files: links,
  });
  if (!sent.ok) {
    await abandon(admin, ctx.tenantId, requestId, uploaded);
    return { success: false, error: SEND_FAIL };
  }

  const { error: emailedError } = await admin
    .from('setup_requests')
    .update({ emailed_at: new Date().toISOString() })
    .eq('id', requestId)
    .eq('tenant_id', ctx.tenantId);
  if (emailedError) console.error('[sendSetupRequest] could not mark the request emailed');

  return { success: true };
}
