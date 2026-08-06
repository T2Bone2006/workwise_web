import { NextResponse } from 'next/server';
import { callAIWithLogging } from '@/lib/services/ai-logger';

type MapResult = {
  columnMapping?: Record<string, string | null>;
  valueTransforms?: Record<string, Record<string, string>>;
};

function formatSampleRows(
  columnNames: string[],
  sampleRows: Record<string, string>[]
): string {
  const rows = sampleRows.slice(0, 5);
  return columnNames
    .map((col) => {
      const values = rows
        .map((row) => {
          const v = String(row[col] ?? '').trim();
          return v ? `"${v.replace(/"/g, '\\"')}"` : null;
        })
        .filter((v): v is string => v != null);
      return values.length > 0 ? `- ${col}: ${values.join(', ')}` : `- ${col}: (empty)`;
    })
    .join('\n');
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      columnNames?: string[];
      sampleRows?: Record<string, string>[];
      importSourceId?: string;
    };
    const { columnNames, sampleRows = [], importSourceId } = body;

    if (!Array.isArray(columnNames) || columnNames.length === 0) {
      return NextResponse.json(
        { error: 'columnNames must be a non-empty array' },
        { status: 400 }
      );
    }

    const sampleSection = formatSampleRows(columnNames, sampleRows);

    const prompt = `You are mapping CSV columns to a job management schema AND normalizing values.

CSV columns and sample values:
${sampleSection}

Our schema:
- customer_name (text - customer name)
- address (text - job address)
- postcode (text - UK postcode)
- description (text - job details)
- priority (ENUM: must be exactly one of: "low", "normal", "high", "emergency")
- job_length (ENUM: must be exactly one of: "half_day", "full_day" - how LONG the job takes, not what time it starts)

Optional: reference_number, scheduled_date

For job_length, look for columns describing duration/shift, e.g. "Time Required",
"Duration", "Job Length", "Shift", "Appointment Length", "Hours". Do not map a
column that only gives a single start time (e.g. "Start Time") to job_length —
that's a time, not a duration.

Return JSON with TWO sections:

1. "columnMapping" - which CSV column maps to which schema field (use exact CSV header names; null if no match)
2. "valueTransforms" - how to transform VALUES in those columns (only for fields that need normalization, e.g. priority, job_length)

Example response:
{
  "columnMapping": {
    "customer_name": "Customer",
    "address": "Job Address",
    "postcode": "Post Code",
    "description": "Notes",
    "priority": "Priority Level",
    "job_length": "Shift",
    "reference_number": null,
    "scheduled_date": null
  },
  "valueTransforms": {
    "priority": {
      "Urgent": "emergency",
      "High": "high",
      "Medium": "normal",
      "Low": "low",
      "default": "normal"
    },
    "job_length": {
      "Full Day": "full_day",
      "HALF DAY": "half_day",
      "FD": "full_day",
      "AM": "half_day"
    }
  }
}

Rules:
- If no priority column exists, use null in columnMapping and set "default": "normal" in valueTransforms.priority
- Map common variations (Urgent/URGENT/urgent → emergency, Medium/Med → normal)
- Always include "default" fallback for enums in valueTransforms — EXCEPT job_length
- job_length must NEVER get a "default" fallback. If a sample value isn't a clear
  half/full day indicator, leave it out of valueTransforms.job_length entirely
  rather than guessing — an unrecognized value should stay unmapped, not be
  forced into half_day or full_day.
- If column not found or low confidence, use null in columnMapping
- Return ONLY valid JSON, no markdown or explanation.`;

    const result = await callAIWithLogging<MapResult>(
      {
        type: 'column_mapping',
        prompt,
        inputData: {
          columnNames,
          sampleRows: sampleRows.slice(0, 5),
          job_type: 'csv_column_mapping',
        },
        importSourceId,
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
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
