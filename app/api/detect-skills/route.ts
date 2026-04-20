import { detectSkills } from '@/lib/detect-skills';
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { description, address, priority } = body;
    if (!description || typeof description !== 'string') {
      return NextResponse.json(
        { error: 'description is required' },
        { status: 400 }
      );
    }
    const result = await detectSkills(
      {
        description,
        address: typeof address === 'string' ? address : undefined,
        priority: typeof priority === 'string' ? priority : undefined,
      }
    );
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
