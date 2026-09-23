'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  findAuthUserByEmail,
  isAlreadyRegisteredAuthError,
} from '@/lib/supabase/find-auth-user';
import { customerSchema } from '@/lib/validations/customer';
import { buildCustomerInviteEmail } from '@/lib/emails/customer-invite';
import { getTenantIdForCurrentUser, getTenantNameForCurrentUser } from '@/lib/data/tenant';
import { resend, FROM_EMAIL } from '@/lib/resend';
import { revalidatePath } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  canonicalFieldKey,
  fieldLabelFromHeader,
  type WorkerVisibleField,
} from '@/lib/jobs/worker-visible-fields';

const ACTIVE_JOB_STATUSES = ['pending', 'assigned', 'in_progress'] as const;

function getRawFormData(formData: FormData) {
  return {
    name: formData.get('name'),
    type: formData.get('type'),
    email: formData.get('email') ?? '',
    phone: formData.get('phone') ?? '',
    address: formData.get('address') ?? '',
    notes: formData.get('notes') ?? '',
  };
}

export async function createCustomer(formData: FormData) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const { data: userData } = await supabase
    .from('users')
    .select('tenant_id')
    .eq('id', user.id)
    .single();

  if (!userData?.tenant_id) {
    return { success: false, error: 'No tenant found' };
  }

  const rawData = getRawFormData(formData);
  const validated = customerSchema.parse(rawData);

  // Prevent duplicate: same email for this tenant (if email provided)
  if (validated.email?.trim()) {
    const { data: existingByEmail } = await supabase
      .from('customers')
      .select('id')
      .eq('tenant_id', userData.tenant_id)
      .eq('email', validated.email.trim())
      .limit(1)
      .maybeSingle();
    if (existingByEmail) {
      return { success: false, error: 'A customer with this email already exists' };
    }
  }

  const { data: inserted, error } = await supabase
    .from('customers')
    .insert({
      tenant_id: userData.tenant_id,
      name: validated.name,
      type: validated.type,
      email: validated.email || null,
      phone: validated.phone || null,
      notes: validated.notes || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (error) {
    console.error('Create customer error:', error);
    return { success: false, error: error.message };
  }

  revalidatePath('/customers');
  revalidatePath('/import');
  return { success: true, id: inserted?.id as string };
}

/** Minimal create for the import wizard (name + bulk_client). Returns new customer id. */
export async function createCustomerForImport(name: string): Promise<{
  success: boolean;
  id?: string;
  name?: string;
  error?: string;
}> {
  const trimmed = name.trim();
  if (trimmed.length < 2) {
    return { success: false, error: 'Name must be at least 2 characters' };
  }
  const fd = new FormData();
  fd.set('name', trimmed);
  fd.set('type', 'bulk_client');
  fd.set('email', '');
  fd.set('phone', '');
  fd.set('address', '');
  fd.set('notes', '');
  const result = await createCustomer(fd);
  if (!result.success) {
    return { success: false, error: 'error' in result ? result.error : 'Failed to create customer' };
  }
  return {
    success: true,
    id: 'id' in result ? result.id : undefined,
    name: trimmed,
  };
}

export async function updateCustomer(customerId: string, formData: FormData) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const { data: userData } = await supabase
    .from('users')
    .select('tenant_id')
    .eq('id', user.id)
    .single();

  if (!userData?.tenant_id) {
    return { success: false, error: 'No tenant found' };
  }

  const { data: existing } = await supabase
    .from('customers')
    .select('id, tenant_id')
    .eq('id', customerId)
    .single();

  if (!existing || existing.tenant_id !== userData.tenant_id) {
    return { success: false, error: 'Customer not found or access denied' };
  }

  const rawData = getRawFormData(formData);
  const validated = customerSchema.parse(rawData);

  // Prevent duplicate: another customer (not this one) with same email in this tenant
  if (validated.email?.trim()) {
    const { data: otherWithEmail } = await supabase
      .from('customers')
      .select('id')
      .eq('tenant_id', userData.tenant_id)
      .eq('email', validated.email.trim())
      .neq('id', customerId)
      .limit(1)
      .maybeSingle();
    if (otherWithEmail) {
      return { success: false, error: 'Another customer with this email already exists' };
    }
  }

  const { error } = await supabase
    .from('customers')
    .update({
      name: validated.name,
      type: validated.type,
      email: validated.email || null,
      phone: validated.phone || null,
      notes: validated.notes || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', customerId)
    .eq('tenant_id', userData.tenant_id);

  if (error) {
    console.error('Update customer error:', error);
    return { success: false, error: error.message };
  }

  revalidatePath('/customers');
  revalidatePath(`/customers/${customerId}`);
  revalidatePath(`/customers/${customerId}/edit`);
  return { success: true };
}

export async function deleteCustomer(customerId: string) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const { data: userData } = await supabase
    .from('users')
    .select('tenant_id')
    .eq('id', user.id)
    .single();

  if (!userData?.tenant_id) {
    return { success: false, error: 'No tenant found' };
  }

  const { data: existing } = await supabase
    .from('customers')
    .select('id, tenant_id')
    .eq('id', customerId)
    .single();

  if (!existing || existing.tenant_id !== userData.tenant_id) {
    return { success: false, error: 'Customer not found or access denied' };
  }

  const { data: portalUser } = await supabase
    .from('customer_portal_users')
    .select('user_id')
    .eq('customer_id', customerId)
    .not('user_id', 'is', null)
    .limit(1)
    .maybeSingle<{ user_id: string }>();

  if (portalUser?.user_id) {
    return {
      success: false,
      error:
        'This customer has portal access. Revoke their portal access first before deleting.',
    };
  }

  const { data: jobs } = await supabase
    .from('jobs')
    .select('id')
    .eq('customer_id', customerId)
    .limit(1);

  if (jobs && jobs.length > 0) {
    return {
      success: false,
      error:
        'This customer has job history. Use Deactivate instead of Delete to preserve records.',
    };
  }

  const { error } = await supabase
    .from('customers')
    .delete()
    .eq('id', customerId)
    .eq('tenant_id', userData.tenant_id);

  if (error) {
    console.error('Delete customer error:', error);
    return { success: false, error: error.message };
  }

  revalidatePath('/customers');
  return { success: true };
}

export async function deactivateCustomer(customerId: string) {
  const tenantId = await getTenantIdForCurrentUser();
  if (!tenantId) return { success: false, error: 'No tenant found' };

  const supabase = await createClient();

  const { data: customer, error: customerError } = await supabase
    .from('customers')
    .select('id, tenant_id')
    .eq('id', customerId)
    .single();

  if (customerError || !customer || customer.tenant_id !== tenantId) {
    return { success: false, error: 'Customer not found or access denied' };
  }

  const { data: portalUser, error: portalUserError } = await supabase
    .from('customer_portal_users')
    .select('user_id')
    .eq('customer_id', customerId)
    .maybeSingle<{ user_id: string | null }>();

  if (portalUserError) {
    console.error('[deactivateCustomer] portal user:', portalUserError);
    return { success: false, error: portalUserError.message };
  }

  const hadPortalAccess = Boolean(portalUser);

  if (portalUser) {
    if (portalUser.user_id) {
      let admin: ReturnType<typeof createAdminClient>;
      try {
        admin = createAdminClient();
      } catch (e) {
        return {
          success: false,
          error: e instanceof Error ? e.message : 'Server configuration error',
        };
      }

      const { error: deleteUsersRowError } = await admin
        .from('users')
        .delete()
        .eq('id', portalUser.user_id);
      if (deleteUsersRowError) {
        console.error('[deactivateCustomer] delete users row:', deleteUsersRowError);
        return { success: false, error: deleteUsersRowError.message };
      }

      const { error: deleteAuthError } = await admin.auth.admin.deleteUser(portalUser.user_id);
      if (deleteAuthError) {
        console.error('[deactivateCustomer] deleteUser:', deleteAuthError);
        return { success: false, error: deleteAuthError.message };
      }
    }

    const { error: deletePortalUserError } = await supabase
      .from('customer_portal_users')
      .delete()
      .eq('customer_id', customerId);
    if (deletePortalUserError) {
      console.error('[deactivateCustomer] delete portal user:', deletePortalUserError);
      return { success: false, error: deletePortalUserError.message };
    }
  }

  const { count: jobHistoryCount, error: jobHistoryError } = await supabase
    .from('jobs')
    .select('*', { count: 'exact', head: true })
    .eq('customer_id', customerId)
    .eq('tenant_id', tenantId);

  if (jobHistoryError) {
    console.error('[deactivateCustomer] job history:', jobHistoryError);
    return { success: false, error: jobHistoryError.message };
  }

  if ((jobHistoryCount ?? 0) === 0 && !hadPortalAccess) {
    const { error: deleteCustomerError } = await supabase
      .from('customers')
      .delete()
      .eq('id', customerId)
      .eq('tenant_id', tenantId);

    if (deleteCustomerError) {
      console.error('[deactivateCustomer] hard delete customer:', deleteCustomerError);
      return { success: false, error: deleteCustomerError.message };
    }
  } else {
    const { error } = await supabase
      .from('customers')
      .update({
        is_active: false,
        updated_at: new Date().toISOString(),
      })
      .eq('id', customerId)
      .eq('tenant_id', tenantId);

    if (error) {
      console.error('[deactivateCustomer]', error);
      return { success: false, error: error.message };
    }
  }

  revalidatePath('/customers');
  revalidatePath(`/customers/${customerId}`);
  return { success: true };
}

export async function reactivateCustomer(customerId: string) {
  const tenantId = await getTenantIdForCurrentUser();
  if (!tenantId) return { success: false, error: 'No tenant found' };

  const supabase = await createClient();

  const { data: customer, error: customerError } = await supabase
    .from('customers')
    .select('id, tenant_id')
    .eq('id', customerId)
    .single();

  if (customerError || !customer || customer.tenant_id !== tenantId) {
    return { success: false, error: 'Customer not found or access denied' };
  }

  const { error } = await supabase
    .from('customers')
    .update({
      is_active: true,
      updated_at: new Date().toISOString(),
    })
    .eq('id', customerId)
    .eq('tenant_id', tenantId);

  if (error) {
    console.error('[reactivateCustomer]', error);
    return { success: false, error: error.message };
  }

  revalidatePath('/customers');
  revalidatePath(`/customers/${customerId}`);
  return { success: true };
}

export async function getCustomerActiveJobCount(customerId: string): Promise<number> {
  const tenantId = await getTenantIdForCurrentUser();
  if (!tenantId) return 0;

  const supabase = await createClient();
  const { count, error } = await supabase
    .from('jobs')
    .select('id', { count: 'exact', head: true })
    .eq('customer_id', customerId)
    .eq('tenant_id', tenantId)
    .in('status', [...ACTIVE_JOB_STATUSES]);

  if (error) {
    console.error('[getCustomerActiveJobCount]', error);
    return 0;
  }

  return count ?? 0;
}

export async function getCustomerPortalInviteState(customerId: string) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      success: false,
      hasEmail: false,
      hasPortalUser: false,
      pendingInviteId: null as string | null,
      error: 'Not authenticated',
    };
  }

  const { data: userData } = await supabase
    .from('users')
    .select('tenant_id')
    .eq('id', user.id)
    .single();

  if (!userData?.tenant_id) {
    return {
      success: false,
      hasEmail: false,
      hasPortalUser: false,
      pendingInviteId: null as string | null,
      error: 'No tenant found',
    };
  }

  const { data: customer, error: customerError } = await supabase
    .from('customers')
    .select('id, email')
    .eq('id', customerId)
    .eq('tenant_id', userData.tenant_id)
    .maybeSingle<{ id: string; email: string | null }>();

  if (customerError) {
    return {
      success: false,
      hasEmail: false,
      hasPortalUser: false,
      pendingInviteId: null as string | null,
      error: customerError.message,
    };
  }

  if (!customer) {
    return {
      success: false,
      hasEmail: false,
      hasPortalUser: false,
      pendingInviteId: null as string | null,
      error: 'Customer not found or access denied',
    };
  }

  const { data: portalLink, error: portalError } = await supabase
    .from('customer_portal_users')
    .select('user_id')
    .eq('customer_id', customerId)
    .limit(1)
    .maybeSingle<{ user_id: string }>();

  if (portalError) {
    return {
      success: false,
      hasEmail: !!customer.email,
      hasPortalUser: false,
      pendingInviteId: null,
      error: portalError.message,
    };
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    admin = null;
  }

  // Prefer admin so pending invites are visible even if RLS is misconfigured.
  const inviteClient = admin ?? supabase;
  const { data: pendingInvite } = await inviteClient
    .from('customer_invites')
    .select('id')
    .eq('customer_id', customerId)
    .eq('tenant_id', userData.tenant_id)
    .is('used_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();

  const { data: acceptedInvite } = await inviteClient
    .from('customer_invites')
    .select('id')
    .eq('customer_id', customerId)
    .eq('tenant_id', userData.tenant_id)
    .not('used_at', 'is', null)
    .limit(1)
    .maybeSingle<{ id: string }>();

  return {
    success: true,
    hasEmail: !!customer.email,
    hasPortalUser: !!portalLink?.user_id,
    pendingInviteId: pendingInvite?.id ?? null,
    hasAcceptedInvite: !!acceptedInvite,
  };
}

/**
 * Create an Auth user for portal invite, or reuse one that already exists for this email.
 * Refuses emails that already belong to a non-portal WorkWise account (office/worker).
 */
async function ensurePortalAuthUser(
  admin: SupabaseClient,
  email: string,
  customerId: string
): Promise<{ userId: string } | { error: string }> {
  const existing = await findAuthUserByEmail(admin, email);

  if (existing) {
    const { data: profile } = await admin
      .from('users')
      .select('role')
      .eq('id', existing.id)
      .maybeSingle<{ role: string | null }>();

    if (profile?.role && profile.role !== 'customer_portal') {
      return {
        error: `This email is already used by a ${profile.role} account and cannot be invited to the portal.`,
      };
    }

    // Clear any prior ban so a re-invite is usable immediately.
    const { error: unbanError } = await admin.auth.admin.updateUserById(existing.id, {
      ban_duration: 'none',
      user_metadata: {
        ...((existing.user_metadata as Record<string, unknown> | null) ?? {}),
        role: 'customer_portal',
        customer_id: customerId,
      },
    });
    if (unbanError) {
      console.error('[ensurePortalAuthUser] update existing user:', unbanError);
    }

    return { userId: existing.id };
  }

  const { data: inviteData, error: inviteError } = await admin.auth.admin.generateLink({
    type: 'invite',
    email,
    options: {
      data: {
        role: 'customer_portal',
        customer_id: customerId,
      },
    },
  });

  if (inviteError) {
    if (isAlreadyRegisteredAuthError(inviteError)) {
      const raced = await findAuthUserByEmail(admin, email);
      if (raced) {
        return { userId: raced.id };
      }
    }
    console.error('[ensurePortalAuthUser] generateLink:', inviteError);
    return { error: inviteError.message };
  }

  const userId = inviteData?.user?.id;
  if (!userId) {
    return { error: 'Failed to resolve invited user id' };
  }

  return { userId };
}

async function upsertCustomerPortalLink(
  admin: SupabaseClient,
  customerId: string,
  userId: string
): Promise<{ error: string } | null> {
  const { data: existingPortalUser } = await admin
    .from('customer_portal_users')
    .select('id, user_id')
    .eq('customer_id', customerId)
    .limit(1)
    .maybeSingle<{ id: string; user_id: string | null }>();

  if (existingPortalUser) {
    if (existingPortalUser.user_id === userId) return null;
    const { error } = await admin
      .from('customer_portal_users')
      .update({ user_id: userId })
      .eq('customer_id', customerId);
    if (error) {
      console.error('[upsertCustomerPortalLink] update:', error);
      return { error: error.message };
    }
    return null;
  }

  const { error } = await admin.from('customer_portal_users').insert({
    customer_id: customerId,
    user_id: userId,
  });
  if (error) {
    console.error('[upsertCustomerPortalLink] insert:', error);
    return { error: error.message };
  }
  return null;
}

async function ensurePortalUsersProfile(
  admin: SupabaseClient,
  userId: string,
  email: string
): Promise<{ error: string } | null> {
  const now = new Date().toISOString();
  const { error } = await admin.from('users').upsert(
    {
      id: userId,
      email,
      role: 'customer_portal',
      tenant_id: null,
      is_active: true,
      updated_at: now,
    },
    { onConflict: 'id' }
  );
  if (error) {
    console.error('[ensurePortalUsersProfile] upsert:', error);
    return { error: error.message };
  }
  return null;
}

async function createAndSendPortalInviteEmail(opts: {
  admin: SupabaseClient;
  customerId: string;
  tenantId: string;
  email: string;
  customerName: string;
  tenantName: string;
  logPrefix: string;
}): Promise<{ success: true } | { success: false; error: string }> {
  // Replace any unused prior invites for this customer so the Invites tab stays clean.
  const { error: deleteOldError } = await opts.admin
    .from('customer_invites')
    .delete()
    .eq('customer_id', opts.customerId)
    .is('used_at', null);

  if (deleteOldError) {
    console.error(`[${opts.logPrefix}] delete old invites:`, deleteOldError);
    return { success: false, error: deleteOldError.message };
  }

  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const { error: inviteTokenError } = await opts.admin.from('customer_invites').insert({
    token,
    customer_id: opts.customerId,
    tenant_id: opts.tenantId,
    email: opts.email,
    expires_at: expiresAt,
  });

  if (inviteTokenError) {
    console.error(`[${opts.logPrefix}] customer_invites insert:`, inviteTokenError);
    return { success: false, error: inviteTokenError.message };
  }

  const inviteUrl = `https://app.joinworkwise.com/portal/accept-invite?token=${token}`;
  const { subject, html } = buildCustomerInviteEmail({
    customerName: opts.customerName,
    inviteUrl,
    tenantName: opts.tenantName,
  });

  try {
    const { error: resendError } = await resend.emails.send({
      from: FROM_EMAIL,
      to: opts.email,
      subject,
      html,
    });
    if (resendError) {
      console.error(`[${opts.logPrefix}] resend:`, resendError);
      return { success: false, error: 'Failed to send invite email' };
    }
  } catch (e) {
    console.error(`[${opts.logPrefix}] resend:`, e);
    return { success: false, error: 'Failed to send invite email' };
  }

  return { success: true };
}

export async function inviteCustomerToPortal(customerId: string) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const { data: userData } = await supabase
    .from('users')
    .select('tenant_id')
    .eq('id', user.id)
    .single();

  if (!userData?.tenant_id) {
    return { success: false, error: 'No tenant found' };
  }

  const tenantId = userData.tenant_id;

  const { data: customer, error: customerError } = await supabase
    .from('customers')
    .select('id, name, email')
    .eq('id', customerId)
    .eq('tenant_id', tenantId)
    .maybeSingle<{ id: string; name: string; email: string | null }>();

  if (customerError) {
    return { success: false, error: customerError.message };
  }
  if (!customer) {
    return { success: false, error: 'Customer not found or access denied' };
  }

  const email = customer.email?.trim().toLowerCase();
  if (!email) {
    return {
      success: false,
      error: 'This customer has no email address. Add one before inviting.',
    };
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Server configuration error',
    };
  }

  const authResult = await ensurePortalAuthUser(admin, email, customerId);
  if ('error' in authResult) {
    return { success: false, error: authResult.error };
  }

  const linkError = await upsertCustomerPortalLink(admin, customerId, authResult.userId);
  if (linkError) {
    return { success: false, error: linkError.error };
  }

  const profileError = await ensurePortalUsersProfile(admin, authResult.userId, email);
  if (profileError) {
    return { success: false, error: profileError.error };
  }

  const tenantName = await getTenantNameForCurrentUser();
  const sendResult = await createAndSendPortalInviteEmail({
    admin,
    customerId,
    tenantId,
    email,
    customerName: customer.name?.trim() || 'there',
    tenantName,
    logPrefix: 'inviteCustomerToPortal',
  });

  if (!sendResult.success) {
    return { success: false, error: sendResult.error };
  }

  revalidatePath('/customers');
  revalidatePath(`/customers/${customerId}`);

  return { success: true };
}


export async function revokeCustomerInvite(inviteId: string) {
  const tenantId = await getTenantIdForCurrentUser();
  if (!tenantId) return { success: false, error: 'No tenant found' };

  const supabase = await createClient();
  let admin;
  try {
    admin = createAdminClient();
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Server configuration error',
    };
  }

  const { data: invite, error: inviteError } = await supabase
    .from('customer_invites')
    .select('id, customer_id, tenant_id, email, used_at')
    .eq('id', inviteId)
    .single();

  if (inviteError || !invite || invite.tenant_id !== tenantId) {
    return { success: false, error: 'Invite not found or access denied' };
  }

  if (invite.used_at) {
    return {
      success: false,
      error: 'This customer has already accepted their invite. Use Revoke Access instead.',
    };
  }

  const { data: portalUser } = await supabase
    .from('customer_portal_users')
    .select('user_id')
    .eq('customer_id', invite.customer_id)
    .maybeSingle<{ user_id: string | null }>();

  const userId = portalUser?.user_id ?? null;

  const { error: deleteInviteError } = await admin
    .from('customer_invites')
    .delete()
    .eq('id', inviteId);

  if (deleteInviteError) {
    console.error('[revokeCustomerInvite] delete invite:', deleteInviteError);
    return { success: false, error: deleteInviteError.message };
  }

  const { error: deletePortalError } = await admin
    .from('customer_portal_users')
    .delete()
    .eq('customer_id', invite.customer_id);

  if (deletePortalError) {
    console.error('[revokeCustomerInvite] delete portal user:', deletePortalError);
    return { success: false, error: deletePortalError.message };
  }

  if (userId) {
    const { error: deleteAuthError } = await admin.auth.admin.deleteUser(userId);
    if (deleteAuthError) {
      console.error('[revokeCustomerInvite] deleteUser:', deleteAuthError);
    }

    const { error: deleteUsersRowError } = await admin.from('users').delete().eq('id', userId);
    if (deleteUsersRowError) {
      console.error('[revokeCustomerInvite] delete users row:', deleteUsersRowError);
    }
  }

  revalidatePath('/customers');
  revalidatePath(`/customers/${invite.customer_id}`);
  return { success: true };
}

export async function resendCustomerInvite(inviteId: string) {
  const tenantId = await getTenantIdForCurrentUser();
  if (!tenantId) return { success: false, error: 'No tenant found' };

  const supabase = await createClient();
  let admin;
  try {
    admin = createAdminClient();
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Server configuration error',
    };
  }

  const { data: invite, error: inviteError } = await supabase
    .from('customer_invites')
    .select('id, customer_id, tenant_id, email')
    .eq('id', inviteId)
    .single();

  if (inviteError || !invite || invite.tenant_id !== tenantId) {
    return { success: false, error: 'Invite not found or access denied' };
  }

  const { data: customer, error: customerError } = await supabase
    .from('customers')
    .select('id, name, email')
    .eq('id', invite.customer_id)
    .eq('tenant_id', tenantId)
    .single();

  if (customerError || !customer) {
    return { success: false, error: 'Customer not found or access denied' };
  }

  const email = (customer.email ?? invite.email ?? '').trim().toLowerCase();
  if (!email) {
    return { success: false, error: 'Customer has no email address' };
  }

  const authResult = await ensurePortalAuthUser(admin, email, customer.id);
  if ('error' in authResult) {
    return { success: false, error: authResult.error };
  }

  const linkError = await upsertCustomerPortalLink(admin, customer.id, authResult.userId);
  if (linkError) {
    return { success: false, error: linkError.error };
  }

  const profileError = await ensurePortalUsersProfile(admin, authResult.userId, email);
  if (profileError) {
    return { success: false, error: profileError.error };
  }

  const tenantName = await getTenantNameForCurrentUser();
  const sendResult = await createAndSendPortalInviteEmail({
    admin,
    customerId: customer.id,
    tenantId,
    email,
    customerName: customer.name?.trim() || 'there',
    tenantName,
    logPrefix: 'resendCustomerInvite',
  });

  if (!sendResult.success) {
    return { success: false, error: sendResult.error };
  }

  revalidatePath('/customers');
  revalidatePath(`/customers/${customer.id}`);
  return { success: true };
}


export async function deactivateCustomerPortalAccess(customerId: string) {
  const tenantId = await getTenantIdForCurrentUser();
  if (!tenantId) return { success: false, error: 'No tenant found' };

  const supabase = await createClient();

  const { data: customer, error: customerError } = await supabase
    .from('customers')
    .select('id, tenant_id')
    .eq('id', customerId)
    .single();

  if (customerError || !customer || customer.tenant_id !== tenantId) {
    return { success: false, error: 'Customer not found or access denied' };
  }

  const { data: portalUser } = await supabase
    .from('customer_portal_users')
    .select('user_id')
    .eq('customer_id', customerId)
    .maybeSingle<{ user_id: string | null }>();

  const userId = portalUser?.user_id ?? null;

  const { error: customerUpdateError } = await supabase
    .from('customers')
    .update({
      portal_last_accessed_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', customerId)
    .eq('tenant_id', tenantId);

  if (customerUpdateError) {
    console.error('[deactivateCustomerPortalAccess] customer update:', customerUpdateError);
    return { success: false, error: customerUpdateError.message };
  }

  const { error: portalDeleteError } = await supabase
    .from('customer_portal_users')
    .delete()
    .eq('customer_id', customerId);

  if (portalDeleteError) {
    console.error('[deactivateCustomerPortalAccess] delete portal user:', portalDeleteError);
    return { success: false, error: portalDeleteError.message };
  }

  if (userId) {
    let admin;
    try {
      admin = createAdminClient();
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e.message : 'Server configuration error',
      };
    }

    const { error: deleteUsersRowError } = await admin.from('users').delete().eq('id', userId);
    if (deleteUsersRowError) {
      console.error('[deactivateCustomerPortalAccess] delete users row:', deleteUsersRowError);
    }

    const { error: deleteAuthError } = await admin.auth.admin.deleteUser(userId);
    if (deleteAuthError) {
      console.error('[deactivateCustomerPortalAccess] deleteUser:', deleteAuthError);
      return { success: false, error: deleteAuthError.message };
    }
  }

  revalidatePath('/customers');
  revalidatePath(`/customers/${customerId}`);
  return { success: true };
}

export async function reactivateCustomerPortalAccess(customerId: string) {
  const tenantId = await getTenantIdForCurrentUser();
  if (!tenantId) return { success: false, error: 'No tenant found' };

  const supabase = await createClient();

  const { data: customer, error: customerError } = await supabase
    .from('customers')
    .select('id, tenant_id')
    .eq('id', customerId)
    .single();

  if (customerError || !customer || customer.tenant_id !== tenantId) {
    return { success: false, error: 'Customer not found or access denied' };
  }

  const { data: portalUser } = await supabase
    .from('customer_portal_users')
    .select('user_id')
    .eq('customer_id', customerId)
    .maybeSingle<{ user_id: string | null }>();

  const userId = portalUser?.user_id ?? null;

  if (userId) {
    let admin;
    try {
      admin = createAdminClient();
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e.message : 'Server configuration error',
      };
    }

    const { error: unbanError } = await admin.auth.admin.updateUserById(userId, {
      ban_duration: '0',
    });
    if (unbanError) {
      console.error('[reactivateCustomerPortalAccess] unban:', unbanError);
      return { success: false, error: unbanError.message };
    }
  }

  revalidatePath('/customers');
  revalidatePath(`/customers/${customerId}`);
  return { success: true };
}


/**
 * Saves which imported columns this customer's workers see, and what they are
 * called on the job screen.
 *
 * The whole list is replaced each save, disabled entries included, so a label
 * edit survives a field being switched off and back on.
 */
export async function updateCustomerWorkerFields(
  customerId: string,
  fields: WorkerVisibleField[]
): Promise<{ success: boolean; error?: string }> {
  const tenantId = await getTenantIdForCurrentUser();
  if (!tenantId) {
    return { success: false, error: 'Not authenticated' };
  }

  const cleaned: WorkerVisibleField[] = [];
  const seen = new Set<string>();
  for (const field of fields) {
    const sourceHeader = String(field?.source_header ?? '').trim();
    const key = String(field?.key ?? '').trim() || canonicalFieldKey(sourceHeader);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const label = String(field?.label ?? '').trim();
    cleaned.push({
      key,
      source_header: sourceHeader || key,
      label: label || fieldLabelFromHeader(sourceHeader || key),
      enabled: field?.enabled !== false,
    });
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from('customers')
    .update({ worker_visible_fields: cleaned, updated_at: new Date().toISOString() })
    .eq('id', customerId)
    .eq('tenant_id', tenantId);

  if (error) {
    console.error('[updateCustomerWorkerFields]', error);
    return { success: false, error: error.message };
  }

  revalidatePath(`/customers/${customerId}`);
  return { success: true };
}
