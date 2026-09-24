import { NextResponse } from 'next/server';
import { z } from 'zod';
import { addServicePresets } from '@/lib/actions/rounds/service-catalog';
import {
  firstZodError,
  readJsonBody,
  requireRoundsApi,
} from '@/lib/api/rounds-request';

export async function GET(request: Request) {
  const auth = await requireRoundsApi(request);
  if (!auth.ok) return auth.response;

  const { data, error } = await auth.ctx.supabase
    .from('service_preset_groups')
    .select(
      'key, label, sort_order, service_presets(name, default_price, default_frequency_days, sort_order)',
    )
    .order('sort_order', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const groups = (data ?? []).map((row) => {
    const record = row as {
      key?: string;
      label?: string;
      service_presets?: Array<{
        name?: string;
        default_price?: number;
        default_frequency_days?: number | null;
        sort_order?: number;
      }>;
    };
    const services = [...(record.service_presets ?? [])]
      .sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0))
      .filter((item) => typeof item.name === 'string')
      .map((item) => ({
        name: item.name as string,
        default_price: Number(item.default_price ?? 0),
        default_frequency_days:
          item.default_frequency_days == null ? null : Number(item.default_frequency_days),
      }));
    return {
      key: record.key ?? '',
      label: record.label ?? '',
      service_count: services.length,
      services,
    };
  }).filter((group) => group.key.length > 0);

  return NextResponse.json({ groups });
}

const postSchema = z.object({
  group: z.string().regex(/^[a-z_]+$/),
});

export async function POST(request: Request) {
  const auth = await requireRoundsApi(request);
  if (!auth.ok) return auth.response;

  const json = await readJsonBody(request);
  if (!json.ok) return json.response;

  const parsed = postSchema.safeParse(json.body);
  if (!parsed.success) {
    return NextResponse.json({ error: firstZodError(parsed.error) }, { status: 400 });
  }

  const result = await addServicePresets(parsed.data.group);
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ added: result.added, label: result.label });
}
