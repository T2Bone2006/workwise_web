import { createClient } from '@/lib/supabase/server';

export type ServiceRow = {
  id: string;
  name: string;
  default_price: number;
  default_duration_minutes: number;
  default_frequency_days: number | null;
  is_active: boolean;
  sort_order: number;
};

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export function mapServiceRow(raw: Record<string, unknown>): ServiceRow | null {
  const id = asString(raw.id);
  const name = asString(raw.name);
  const price = asFiniteNumber(raw.default_price);
  const duration = asFiniteNumber(raw.default_duration_minutes);
  if (!id || !name || price == null || duration == null) return null;
  return {
    id,
    name,
    default_price: price,
    default_duration_minutes: duration,
    default_frequency_days: asFiniteNumber(raw.default_frequency_days),
    is_active: raw.is_active !== false,
    sort_order: asFiniteNumber(raw.sort_order) ?? 0,
  };
}

export async function getServiceCatalog(
  tenantId: string,
  opts?: { includeInactive?: boolean },
): Promise<{ services: ServiceRow[]; error: Error | null }> {
  try {
    const supabase = await createClient();
    let query = supabase
      .from('service_catalog')
      .select(
        'id, name, default_price, default_duration_minutes, default_frequency_days, is_active, sort_order',
      )
      .eq('tenant_id', tenantId)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });

    if (!opts?.includeInactive) {
      query = query.eq('is_active', true);
    }

    const { data, error } = await query;
    if (error) {
      console.error('[getServiceCatalog]', error);
      return { services: [], error: new Error(error.message) };
    }

    const services: ServiceRow[] = [];
    for (const row of data ?? []) {
      const mapped = mapServiceRow(row as Record<string, unknown>);
      if (mapped) services.push(mapped);
    }
    return { services, error: null };
  } catch (err) {
    console.error('[getServiceCatalog]', err);
    return {
      services: [],
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

function mapPresetItems(raw: unknown): ServicePresetItem[] {
  if (!Array.isArray(raw)) return [];
  const items: Array<ServicePresetItem & { sort: number }> = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const record = row as Record<string, unknown>;
    const name = asString(record.name);
    const price = asFiniteNumber(record.default_price);
    if (!name || price == null) continue;
    items.push({
      name,
      defaultPrice: price,
      defaultFrequencyDays: asFiniteNumber(record.default_frequency_days),
      sort: asFiniteNumber(record.sort_order) ?? 0,
    });
  }
  items.sort((a, b) => a.sort - b.sort);
  return items.map(({ name, defaultPrice, defaultFrequencyDays }) => ({
    name,
    defaultPrice,
    defaultFrequencyDays,
  }));
}

export type ServicePresetItem = {
  name: string;
  defaultPrice: number;
  defaultFrequencyDays: number | null;
};

export type ServicePresetGroup = {
  key: string;
  label: string;
  services: ServicePresetItem[];
};

export async function getServicePresetGroups(): Promise<{
  groups: ServicePresetGroup[];
  error: Error | null;
}> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('service_preset_groups')
      .select(
        'key, label, sort_order, service_presets(name, default_price, default_frequency_days, sort_order)',
      )
      .order('sort_order', { ascending: true });

    if (error) {
      console.error('[getServicePresetGroups]', error);
      return { groups: [], error: new Error(error.message) };
    }

    const groups: ServicePresetGroup[] = [];
    for (const row of data ?? []) {
      const record = row as Record<string, unknown>;
      const key = asString(record.key);
      const label = asString(record.label);
      if (!key || !label) continue;
      const services = mapPresetItems(record.service_presets);
      groups.push({ key, label, services });
    }
    return { groups, error: null };
  } catch (err) {
    console.error('[getServicePresetGroups]', err);
    return {
      groups: [],
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}
