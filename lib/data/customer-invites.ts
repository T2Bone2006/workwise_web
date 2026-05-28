import { createClient } from '@/lib/supabase/server';
import type { CustomerType } from '@/lib/data/customers';

export interface CustomerInviteRow {
  inviteId: string;
  email: string;
  createdAt: string;
  expiresAt: string;
  isExpired: boolean;
  customer: {
    id: string;
    name: string;
    type: string;
  };
}

export interface CustomerPortalAccessRow {
  id: string;
  name: string;
  email: string | null;
  type: CustomerType;
  portal_last_accessed_at: string | null;
  user_id: string;
}

export async function getCustomerInvitesForTenant(
  tenantId: string
): Promise<{ invites: CustomerInviteRow[]; error: Error | null }> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('customer_invites')
      .select(
        `
        id,
        token,
        email,
        created_at,
        expires_at,
        used_at,
        customers!inner (
          id,
          name,
          type
        )
      `
      )
      .eq('tenant_id', tenantId)
      .is('used_at', null)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[getCustomerInvitesForTenant]', error);
      return { invites: [], error: new Error(error.message ?? 'Failed to load invites') };
    }

    const now = Date.now();
    const invites: CustomerInviteRow[] = (Array.isArray(data) ? data : []).map((row) => {
      const customersRaw = row.customers as
        | { id: string; name: string; type?: string }
        | Array<{ id: string; name: string; type?: string }>;
      const customer = Array.isArray(customersRaw) ? customersRaw[0] : customersRaw;
      const expiresAt = String(row.expires_at ?? '');
      return {
        inviteId: String(row.id),
        email: String(row.email ?? ''),
        createdAt: String(row.created_at ?? ''),
        expiresAt,
        isExpired: expiresAt ? new Date(expiresAt).getTime() < now : false,
        customer: {
          id: customer?.id ?? '',
          name: customer?.name ?? '',
          type: (customer?.type as string) ?? 'individual',
        },
      };
    });

    return { invites, error: null };
  } catch (err) {
    console.error('[getCustomerInvitesForTenant]', err);
    return {
      invites: [],
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

export async function getCustomersWithPortalAccess(
  tenantId: string
): Promise<{ customers: CustomerPortalAccessRow[]; error: Error | null }> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('customers')
      .select(
        `
        id,
        name,
        email,
        type,
        portal_last_accessed_at,
        customer_portal_users!inner (
          user_id
        )
      `
      )
      .eq('tenant_id', tenantId)
      .not('customer_portal_users.user_id', 'is', null)
      .order('name');

    if (error) {
      console.error('[getCustomersWithPortalAccess]', error);
      return {
        customers: [],
        error: new Error(error.message ?? 'Failed to load portal access'),
      };
    }

    const customers: CustomerPortalAccessRow[] = (Array.isArray(data) ? data : []).map(
      (row) => {
        const portalRaw = row.customer_portal_users as
          | { user_id: string }
          | Array<{ user_id: string }>;
        const portal = Array.isArray(portalRaw) ? portalRaw[0] : portalRaw;
        return {
          id: String(row.id),
          name: String(row.name ?? ''),
          email: row.email != null ? String(row.email) : null,
          type: (row.type as CustomerType) ?? 'individual',
          portal_last_accessed_at:
            row.portal_last_accessed_at != null
              ? String(row.portal_last_accessed_at)
              : null,
          user_id: String(portal?.user_id ?? ''),
        };
      }
    );

    return { customers, error: null };
  } catch (err) {
    console.error('[getCustomersWithPortalAccess]', err);
    return {
      customers: [],
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}
