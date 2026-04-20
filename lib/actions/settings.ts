'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import type {
  TenantSettings,
  IntegrationsSettings,
  NotificationsSettings,
  IndustryOption,
} from '@/lib/data/settings-types';

async function getTenantId(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) return null;
  const { data: row } = await supabase
    .from('users')
    .select('tenant_id')
    .eq('id', user.id)
    .maybeSingle();
  return row?.tenant_id ?? null;
}

export async function updateCompanySettings(formData: FormData): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const tenantId = await getTenantId();
  if (!tenantId) return { success: false, error: 'No tenant found' };

  const name = (formData.get('name') as string)?.trim();
  const industry = (formData.get('industry') as string)?.trim() as IndustryOption | undefined;
  const phone = (formData.get('phone') as string)?.trim() || undefined;
  const email = (formData.get('email') as string)?.trim() || undefined;
  const address = (formData.get('address') as string)?.trim() || undefined;

  const validIndustries: IndustryOption[] = ['Locksmith', 'Plumbing', 'Electrical', 'HVAC', 'General'];
  const industryValue = industry && validIndustries.includes(industry) ? industry : undefined;

  const { data: tenant } = await supabase
    .from('tenants')
    .select('settings')
    .eq('id', tenantId)
    .single();

  const currentSettings: TenantSettings = (tenant?.settings as TenantSettings) ?? {};
  const company = { ...currentSettings.company, industry: industryValue, phone, email, address };

  const newSettings = { ...currentSettings, company };

  const updates: { name?: string; industry?: string; settings?: TenantSettings } = { settings: newSettings };
  if (name) updates.name = name;
  if (industryValue) updates.industry = industryValue;

  const { error } = await supabase.from('tenants').update(updates).eq('id', tenantId);

  if (error) {
    console.error('updateCompanySettings', error);
    return { success: false, error: error.message };
  }
  revalidatePath('/settings');
  return { success: true };
}

function maskApiKey(key: string): string {
  if (!key || key.length < 8) return '••••••••';
  return key.slice(0, 7) + '...••••';
}

function validateAnthropicKey(key: string): boolean {
  return /^sk-ant-/.test(key);
}
function validateVAPIKey(key: string): boolean {
  return /^sk-vapi-/.test(key);
}

export async function updateIntegrations(integrations: IntegrationsSettings): Promise<{ success: boolean; error?: string }> {
  const tenantId = await getTenantId();
  if (!tenantId) return { success: false, error: 'No tenant found' };

  const supabase = await createClient();
  const { data: tenant } = await supabase
    .from('tenants')
    .select('settings')
    .eq('id', tenantId)
    .single();

  const currentSettings: TenantSettings = (tenant?.settings as TenantSettings) ?? {};
  const currentIntegrations = currentSettings.integrations ?? {};

  const next: IntegrationsSettings = { ...currentIntegrations };

  if (integrations.anthropic !== undefined) {
    next.anthropic = {
      ...currentIntegrations.anthropic,
      ...integrations.anthropic,
      configured: !!integrations.anthropic.configured,
      api_key_masked: integrations.anthropic.api_key_masked ?? currentIntegrations.anthropic?.api_key_masked,
    };
  }
  if (integrations.vapi !== undefined) {
    next.vapi = {
      ...currentIntegrations.vapi,
      ...integrations.vapi,
      configured: !!integrations.vapi.configured,
      api_key_masked: integrations.vapi.api_key_masked ?? currentIntegrations.vapi?.api_key_masked,
    };
  }
  if (integrations.xero !== undefined) {
    next.xero = { ...currentIntegrations.xero, ...integrations.xero };
  }

  const newSettings = { ...currentSettings, integrations: next };
  const { error } = await supabase
    .from('tenants')
    .update({ settings: newSettings })
    .eq('id', tenantId);

  if (error) {
    console.error('updateIntegrations', error);
    return { success: false, error: error.message };
  }
  revalidatePath('/settings');
  return { success: true };
}

/** Call from client with plain API key; we store masked and optionally validate. */
export async function saveAnthropicApiKey(apiKey: string): Promise<{ success: boolean; error?: string }> {
  if (!apiKey?.trim()) return { success: false, error: 'API key is required' };
  if (!validateAnthropicKey(apiKey.trim())) return { success: false, error: 'Invalid format. Key should start with sk-ant-' };
  const tenantId = await getTenantId();
  if (!tenantId) return { success: false, error: 'No tenant found' };

  const supabase = await createClient();
  const { data: tenant } = await supabase
    .from('tenants')
    .select('settings')
    .eq('id', tenantId)
    .single();

  const currentSettings: TenantSettings = (tenant?.settings as TenantSettings) ?? {};
  const integrations = currentSettings.integrations ?? {};
  const anthropic = {
    ...integrations.anthropic,
    configured: true,
    api_key_masked: maskApiKey(apiKey),
    usage_this_month_usd: integrations.anthropic?.usage_this_month_usd ?? 0,
  };
  const newSettings = {
    ...currentSettings,
    integrations: { ...integrations, anthropic },
  };
  const { error } = await supabase
    .from('tenants')
    .update({ settings: newSettings })
    .eq('id', tenantId);

  if (error) return { success: false, error: error.message };
  revalidatePath('/settings');
  return { success: true };
}

export async function saveVAPIApiKey(apiKey: string, phoneNumber?: string): Promise<{ success: boolean; error?: string }> {
  if (!apiKey?.trim()) return { success: false, error: 'API key is required' };
  if (!validateVAPIKey(apiKey.trim())) return { success: false, error: 'Invalid format. Key should start with sk-vapi-' };
  const tenantId = await getTenantId();
  if (!tenantId) return { success: false, error: 'No tenant found' };

  const supabase = await createClient();
  const { data: tenant } = await supabase
    .from('tenants')
    .select('settings')
    .eq('id', tenantId)
    .single();

  const currentSettings: TenantSettings = (tenant?.settings as TenantSettings) ?? {};
  const integrations = currentSettings.integrations ?? {};
  const vapi = {
    ...integrations.vapi,
    configured: true,
    api_key_masked: maskApiKey(apiKey),
    phone_number: phoneNumber?.trim() || integrations.vapi?.phone_number,
  };
  const newSettings = { ...currentSettings, integrations: { ...integrations, vapi } };
  const { error } = await supabase
    .from('tenants')
    .update({ settings: newSettings })
    .eq('id', tenantId);

  if (error) return { success: false, error: error.message };
  revalidatePath('/settings');
  return { success: true };
}

export async function updateNotifications(notifications: NotificationsSettings): Promise<{ success: boolean; error?: string }> {
  const tenantId = await getTenantId();
  if (!tenantId) return { success: false, error: 'No tenant found' };

  const supabase = await createClient();
  const { data: tenant } = await supabase
    .from('tenants')
    .select('settings')
    .eq('id', tenantId)
    .single();

  const currentSettings: TenantSettings = (tenant?.settings as TenantSettings) ?? {};
  const newSettings = { ...currentSettings, notifications };

  const { error } = await supabase
    .from('tenants')
    .update({ settings: newSettings })
    .eq('id', tenantId);

  if (error) {
    console.error('updateNotifications', error);
    return { success: false, error: error.message };
  }
  revalidatePath('/settings');
  return { success: true };
}

export async function updateUserProfile(formData: FormData): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const fullName = (formData.get('full_name') as string)?.trim();
  const phone = (formData.get('phone') as string)?.trim();

  const tenantId = await getTenantId();
  if (tenantId && phone !== undefined) {
    const { data: tenant } = await supabase
      .from('tenants')
      .select('settings')
      .eq('id', tenantId)
      .single();
    const currentSettings: TenantSettings = (tenant?.settings as TenantSettings) ?? {};
    const userPhone = { ...(currentSettings.user_phone ?? {}), [user.id]: phone || '' };
    const newSettings = { ...currentSettings, user_phone: userPhone };
    await supabase.from('tenants').update({ settings: newSettings }).eq('id', tenantId);
  }

  const { error } = await supabase
    .from('users')
    .update({ full_name: fullName || null, updated_at: new Date().toISOString() })
    .eq('id', user.id);

  if (error) {
    console.error('updateUserProfile', error);
    return { success: false, error: error.message };
  }
  revalidatePath('/settings');
  return { success: true };
}

export async function changePassword(
  currentPassword: string,
  newPassword: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: user.email!,
    password: currentPassword,
  });
  if (signInError) return { success: false, error: 'Current password is incorrect' };

  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) return { success: false, error: error.message };
  revalidatePath('/settings');
  return { success: true };
}

export async function dangerDeleteAllJobs(password: string): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };
  const tenantId = await getTenantId();
  if (!tenantId) return { success: false, error: 'No tenant found' };

  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: user.email!,
    password,
  });
  if (signInError) return { success: false, error: 'Password incorrect' };

  const { error } = await supabase.from('jobs').delete().eq('tenant_id', tenantId);
  if (error) return { success: false, error: error.message };
  revalidatePath('/settings');
  revalidatePath('/jobs');
  return { success: true };
}

export async function dangerResetWorkerData(): Promise<{ success: boolean; error?: string }> {
  const tenantId = await getTenantId();
  if (!tenantId) return { success: false, error: 'No tenant found' };
  const supabase = await createClient();
  const { data: workers } = await supabase
    .from('workers')
    .select('id')
    .eq('primary_tenant_id', tenantId);
  const ids = (workers ?? []).map((w: { id: string }) => w.id);
  if (ids.length === 0) return { success: true };
  const { error } = await supabase.from('worker_tenants').delete().in('worker_id', ids);
  if (error) return { success: false, error: error.message };
  revalidatePath('/settings');
  revalidatePath('/workers');
  return { success: true };
}

export async function dangerDeleteTenant(companyName: string, password: string): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };
  const tenantId = await getTenantId();
  if (!tenantId) return { success: false, error: 'No tenant found' };

  const { data: tenant } = await supabase
    .from('tenants')
    .select('name')
    .eq('id', tenantId)
    .single();
  if (!tenant || (tenant.name ?? '').trim() !== companyName.trim()) {
    return { success: false, error: 'Company name does not match' };
  }

  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: user.email!,
    password,
  });
  if (signInError) return { success: false, error: 'Password incorrect' };

  const { error } = await supabase.from('tenants').delete().eq('id', tenantId);
  if (error) return { success: false, error: error.message };
  revalidatePath('/settings');
  return { success: true };
}
