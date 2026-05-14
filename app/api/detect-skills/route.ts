import { detectSkills } from '@/lib/detect-skills';
import { NextResponse } from 'next/server';

function parseTenantSkills(raw: unknown): { key: string; label: string }[] {
  if (!Array.isArray(raw)) return [];
  const out: { key: string; label: string }[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const k = 'key' in item && typeof item.key === 'string' ? item.key.trim() : '';
    const lbl =
      'label' in item && typeof item.label === 'string' ? item.label.trim() : '';
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push({ key: k, label: lbl || k });
  }
  return out;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { description, address, priority, tenantSkills: rawTenantSkills } = body;
    if (!description || typeof description !== 'string') {
      return NextResponse.json(
        { error: 'description is required' },
        { status: 400 }
      );
    }
    const tenantSkills = parseTenantSkills(rawTenantSkills);
    const result = await detectSkills({
      description,
      address: typeof address === 'string' ? address : undefined,
      priority: typeof priority === 'string' ? priority : undefined,
      tenantSkills,
    });
    return NextResponse.json({
      skills: result.data,
      interactionId: result.interactionId,
    });
  } catch (err) {
    console.error('[detect-skills API]', err);
    return NextResponse.json(
      { error: 'Failed to detect skills' },
      { status: 500 }
    );
  }
}
