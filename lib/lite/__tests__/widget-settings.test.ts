import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import {
  saveWidgetLook,
  saveWidgetTexts,
  saveWidgetWebsite,
  setWidgetActive,
} from '@/lib/lite/widget-settings';
import type { LiteContext } from '@/lib/lite/require-lite';

type Rec = Record<string, unknown>;

const CTX: LiteContext = {
  tenantId: 'tenant-1',
  userId: 'user-1',
  widget: {
    id: 'widget-1',
    business_name: "Dave's Plastering",
    sign_off_name: 'Dave',
    trade: 'plasterer',
    service_area: 'Wigan',
    business_context: '',
  },
};

function harness(row: Rec) {
  function from() {
    const filters: Array<(current: Rec) => boolean> = [];
    let patch: Rec | null = null;
    const matches = () => filters.every((pred) => pred(row));
    const api = {
      select: () => api,
      update: (next: Rec) => {
        patch = next;
        return api;
      },
      eq: (key: string, value: unknown) => {
        filters.push((current) => current[key] === value);
        return api;
      },
      maybeSingle: async () => ({ data: matches() ? { ...row } : null, error: null }),
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => {
        const hit = matches();
        if (patch && hit) Object.assign(row, patch);
        const payload = patch ? { data: hit ? [{ id: row.id }] : [], error: null } : { data: hit ? { ...row } : null, error: null };
        return Promise.resolve(payload).then(resolve, reject);
      },
    };
    return api;
  }
  return { admin: { from } as unknown as SupabaseClient, row };
}

const baseTexts = {
  signOffName: 'Dave',
  ownerMobile: '07700 900123',
  followUpEnabled: true,
  textMeToo: false,
  notificationEmail: 'dave@example.com',
};

describe('widget settings', () => {
  it('stores one bare website and replaces the previous one', async () => {
    const { admin, row } = harness({
      id: 'widget-1',
      tenant_id: 'tenant-1',
      allowed_domains: ['old.co.uk'],
      website_url: 'old.co.uk',
    });
    const bad = await saveWidgetWebsite(admin, CTX, 'not a website');
    expect(bad).toEqual({
      ok: false,
      error: "That doesn't look like a website address \u2014 try something like daveplastering.co.uk",
    });
    expect(row.allowed_domains).toEqual(['old.co.uk']);

    const saved = await saveWidgetWebsite(admin, CTX, 'https://www.DavePlastering.co.uk/contact');
    expect(saved).toEqual({ ok: true, host: 'daveplastering.co.uk' });
    expect(row.allowed_domains).toEqual(['daveplastering.co.uk']);
    expect(row.website_url).toBe('daveplastering.co.uk');
  });

  it('refuses Text me too without a mobile', async () => {
    const { admin, row } = harness({
      id: 'widget-1',
      tenant_id: 'tenant-1',
      owner_mobile_e164: null,
      text_me_too: false,
    });
    const result = await saveWidgetTexts(admin, CTX, { ...baseTexts, ownerMobile: '', textMeToo: true });
    expect(result).toEqual({ ok: false, field: 'textMeToo', error: 'Add your mobile first.' });
    expect(row.text_me_too).toBe(false);
  });

  it('switches Text me too off when the mobile is cleared', async () => {
    const { admin, row } = harness({
      id: 'widget-1',
      tenant_id: 'tenant-1',
      owner_mobile_e164: '+447700900123',
      text_me_too: true,
    });
    const result = await saveWidgetTexts(admin, CTX, { ...baseTexts, ownerMobile: '', textMeToo: true });
    expect(result).toEqual({
      ok: true,
      note: "Text me too was switched off because there's no mobile.",
    });
    expect(row.owner_mobile_e164).toBeNull();
    expect(row.text_me_too).toBe(false);
    expect(row.sign_off_name).toBe('Dave');
  });

  it('refuses a landline and a bad email', async () => {
    const { admin } = harness({
      id: 'widget-1',
      tenant_id: 'tenant-1',
      owner_mobile_e164: null,
      text_me_too: false,
    });
    const landline = await saveWidgetTexts(admin, CTX, { ...baseTexts, ownerMobile: '0161 496 0000' });
    expect(landline).toMatchObject({ ok: false, field: 'ownerMobile', error: 'Please enter a UK mobile number.' });
    const email = await saveWidgetTexts(admin, CTX, { ...baseTexts, notificationEmail: 'dave' });
    expect(email).toMatchObject({ ok: false, field: 'notificationEmail', error: 'Please check the email address.' });
  });

  it('pauses and resumes the assistant', async () => {
    const { admin, row } = harness({ id: 'widget-1', tenant_id: 'tenant-1', active: true });
    expect(await setWidgetActive(admin, CTX, false)).toEqual({ ok: true });
    expect(row.active).toBe(false);
    expect(await setWidgetActive(admin, CTX, true)).toEqual({ ok: true });
    expect(row.active).toBe(true);
  });

  it('refuses a bad colour and a short greeting', async () => {
    const { admin, row } = harness({ id: 'widget-1', tenant_id: 'tenant-1', primary_colour: '#0C66E4', greeting: 'Hello there' });
    expect(await saveWidgetLook(admin, CTX, { primaryColour: 'red', greeting: 'Hello there' })).toMatchObject({
      ok: false,
      error: 'Pick a colour like #0C66E4.',
    });
    expect(await saveWidgetLook(admin, CTX, { primaryColour: '#12345', greeting: 'Hello there' })).toMatchObject({ ok: false });
    expect(await saveWidgetLook(admin, CTX, { primaryColour: '#112233', greeting: 'Hi' })).toMatchObject({
      ok: false,
      error: 'Write a greeting between 5 and 200 characters.',
    });
    expect(row.primary_colour).toBe('#0C66E4');
    const saved = await saveWidgetLook(admin, CTX, { primaryColour: '#112233', greeting: 'Hello there' });
    expect(saved).toEqual({ ok: true });
    expect(row.primary_colour).toBe('#112233');
    expect(row.greeting).toBe('Hello there');
  });
});
