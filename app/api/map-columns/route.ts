import { NextResponse } from 'next/server';
import { callAIWithLogging } from '@/lib/services/ai-logger';
import {
  applyAliasRules,
  buildBindPrompt,
  countCriticalMappings,
  formatSampleRowsForBind,
  mergeAliasAndAiMapping,
  normalizeHeaders,
  normalizeRowKeys,
  sanitizeValueTransforms,
  unboundSchemaKeys,
  type ValueTransforms,
} from '@/lib/import/bind-columns';

type AiMapResult = {
  columnMapping?: Record<string, string | null>;
  valueTransforms?: Record<string, Record<string, string>>;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      columnNames?: string[];
      sampleRows?: Record<string, string>[];
      importSourceId?: string;
    };

    const rawHeaders = body.columnNames;
    if (!Array.isArray(rawHeaders) || rawHeaders.length === 0) {
      return NextResponse.json(
        { error: 'columnNames must be a non-empty array' },
        { status: 400 }
      );
    }

    const headers = normalizeHeaders(rawHeaders);
    if (headers.length === 0) {
      return NextResponse.json({ error: 'No usable column headers' }, { status: 400 });
    }

    const sampleRows = (body.sampleRows ?? [])
      .slice(0, 5)
      .map((row) => normalizeRowKeys(row, headers));

    const { mapping: aliasMapping, aliasedFields } = applyAliasRules(headers);
    const unbound = unboundSchemaKeys(aliasMapping);
    const sampleSection = formatSampleRowsForBind(headers, sampleRows);

    let aiMapping: Record<string, string | null | undefined> = {};
    let aiTransforms: ValueTransforms = {};

    // Always call AI for transforms + any unbound fields (one cheap Haiku call).
    const prompt = buildBindPrompt({
      headers,
      sampleSection,
      unboundKeys: unbound,
      aliasMapping,
    });

    const result = await callAIWithLogging<AiMapResult>(
      {
        type: 'column_mapping',
        prompt,
        inputData: {
          columnNames: headers,
          sampleRows,
          aliasedFields,
          unboundFields: unbound,
          job_type: 'csv_column_mapping',
        },
        importSourceId: body.importSourceId,
        max_tokens: 1200,
      },
      (response) => {
        let raw = response.trim();
        if (raw.startsWith('```')) {
          raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
        }
        return JSON.parse(raw) as AiMapResult;
      }
    );

    aiMapping = result.data.columnMapping ?? {};
    aiTransforms = result.data.valueTransforms ?? {};

    const mapping = mergeAliasAndAiMapping(headers, aliasMapping, aiMapping);
    const transforms = sanitizeValueTransforms(aiTransforms);
    const { critical, total } = countCriticalMappings(mapping);

    return NextResponse.json({
      mapping,
      transforms,
      meta: {
        aliasedFields,
        criticalMapped: critical,
        totalMapped: total,
      },
    });
  } catch (e) {
    console.error('[map-columns]', e);
    const errMessage = e instanceof Error ? e.message : 'AI mapping failed';
    return NextResponse.json({ error: errMessage }, { status: 500 });
  }
}
