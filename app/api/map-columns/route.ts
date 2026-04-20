import { NextResponse } from 'next/server';
import { callAIWithLogging } from '@/lib/services/ai-logger';

type MapResult = {
  columnMapping?: Record<string, string | null>;
  valueTransforms?: Record<string, Record<string, string>>;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      columnNames?: string[];
      importSourceId?: string;
    };
    const { columnNames, importSourceId } = body;

    if (!Array.isArray(columnNames) || columnNames.length === 0) {
      return NextResponse.json(
        { error: 'columnNames must be a non-empty array' },
        { status: 400 }
      );
    }

    const prompt = `You are mapping CSV columns to a job management schema AND normalizing values.

CSV columns: ${columnNames.join(', ')}

Our schema:
- customer_name (text - customer name)
- address (text - job address)
- postcode (text - UK postcode)
- description (text - job details)
- priority (ENUM: must be exactly one of: "low", "normal", "high", "emergency")

Optional: reference_number, scheduled_date, worker_name (assigned worker)

Return JSON with TWO sections:

1. "columnMapping" - which CSV column maps to which schema field (use exact CSV header names; null if no match)
2. "valueTransforms" - how to transform VALUES in those columns (only for fields that need normalization, e.g. priority)

Example response:
{
  "columnMapping": {
    "customer_name": "Customer",
    "address": "Job Address",
    "postcode": "Post Code",
    "description": "Notes",
    "priority": "Priority Level",
    "reference_number": null,
    "scheduled_date": null,
    "worker_name": null
  },
  "valueTransforms": {
    "priority": {
      "Urgent": "emergency",
      "High": "high",
      "Medium": "normal",
      "Low": "low",
      "default": "normal"
    }
  }
}

Rules:
- If no priority column exists, use null in columnMapping and set "default": "normal" in valueTransforms.priority
- Map common variations (Urgent/URGENT/urgent → emergency, Medium/Med → normal)
- Always include "default" fallback for enums in valueTransforms
- If column not found or low confidence, use null in columnMapping
- Return ONLY valid JSON, no markdown or explanation.`;

    const result = await callAIWithLogging<MapResult>(
      {
        type: 'column_mapping',
        prompt,
        inputData: {
          columnNames,
          job_type: 'locksmith',
        },
        importSourceId,
        max_tokens: 1500,
      },
      (response) => {
        let raw = response.trim();
        if (raw.startsWith('```')) {
          raw = raw.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
        }
        return JSON.parse(raw) as MapResult;
      }
    );

    const mapping = result.data.columnMapping ?? {};
    const transforms = result.data.valueTransforms ?? {};
    return NextResponse.json({ mapping, transforms });
  } catch (e) {
    console.error('[map-columns]', e);
    const errMessage = e instanceof Error ? e.message : 'AI mapping failed';
    return NextResponse.json({ error: errMessage }, { status: 500 });
  }
}
