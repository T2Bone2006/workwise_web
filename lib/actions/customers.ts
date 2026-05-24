'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { customerSchema } from '@/lib/validations/customer';
import { buildCustomerInviteEmail } from '@/lib/emails/customer-invite';
import { getTenantNameForCurrentUser } from '@/lib/data/tenant';
import { resend, FROM_EMAIL } from '@/lib/resend';
import { revalidatePath } from 'next/cache';

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

  const { error } = await supabase.from('customers').insert({
    tenant_id: userData.tenant_id,
    name: validated.name,
    type: validated.type,
    email: validated.email || null,
    phone: validated.phone || null,
    notes: validated.notes || null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  if (error) {
    console.error('Create customer error:', error);
    return { success: false, error: error.message };
  }

  revalidatePath('/customers');
  return { success: true };
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

  const { data: jobs } = await supabase
    .from('jobs')
    .select('id')
    .eq('customer_id', customerId)
    .limit(1);

  if (jobs && jobs.length > 0) {
    return {
      success: false,
      error: 'Cannot delete customer with existing jobs',
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
      error: customerError.message,
    };
  }

  if (!customer) {
    return {
      success: false,
      hasEmail: false,
      hasPortalUser: false,
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
      error: portalError.message,
    };
  }

  return {
    success: true,
    hasEmail: !!customer.email,
    hasPortalUser: !!portalLink?.user_id,
  };
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
    console.error('[inviteCustomerToPortal] generateLink:', inviteError);
    return { success: false, error: inviteError.message };
  }

  const invitedUserId = inviteData?.user?.id;
  if (!invitedUserId) {
    return { success: false, error: 'Failed to resolve invited user id' };
  }

  const { data: existingPortalUser } = await supabase
    .from('customer_portal_users')
    .select('user_id')
    .eq('customer_id', customerId)
    .limit(1)
    .maybeSingle<{ user_id: string }>();

  if (existingPortalUser) {
    const { error: updatePortalError } = await supabase
      .from('customer_portal_users')
      .update({ user_id: invitedUserId })
      .eq('customer_id', customerId);

    if (updatePortalError) {
      console.error('[inviteCustomerToPortal] update customer_portal_users:', updatePortalError);
      return { success: false, error: updatePortalError.message };
    }
  } else {
    const { error: insertPortalError } = await supabase.from('customer_portal_users').insert({
      customer_id: customerId,
      user_id: invitedUserId,
    });

    if (insertPortalError) {
      console.error('[inviteCustomerToPortal] insert customer_portal_users:', insertPortalError);
      return { success: false, error: insertPortalError.message };
    }
  }

  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const { error: inviteTokenError } = await admin.from('customer_invites').insert({
    token,
    customer_id: customerId,
    tenant_id: tenantId,
    email,
    expires_at: expiresAt,
  });

  if (inviteTokenError) {
    console.error('[inviteCustomerToPortal] customer_invites insert:', inviteTokenError);
    return { success: false, error: inviteTokenError.message };
  }

  const tenantName = await getTenantNameForCurrentUser();
  const inviteUrl = `https://app.joinworkwise.com/portal/accept-invite?token=${token}`;
  const { subject, html } = buildCustomerInviteEmail({
    customerName: customer.name?.trim() || 'there',
    inviteUrl,
    tenantName,
  });

  try {
    await resend.emails.send({
      from: FROM_EMAIL,
      to: email,
      subject,
      html,
    });
  } catch (e) {
    console.error('[inviteCustomerToPortal] resend:', e);
  }

  revalidatePath('/customers');
  revalidatePath(`/customers/${customerId}`);

  return { success: true };
}
