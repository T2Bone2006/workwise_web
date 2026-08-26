'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { autoAllocateJobGroup } from '@/lib/actions/jobs';
import { clusterKeyForPostcode } from '@/lib/jobs/assignment-ranking';
import { getTenantSkillsById } from '@/lib/actions/skills';
import { detectSkills } from '@/lib/detect-skills';
import { buildFullAddressString, resolveJobCoordinates } from '@/lib/utils/geocoding';
import {
  applyResolvedDate,
  collectUnparsedDateValues,
  isScheduledDateMapped,
} from '@/lib/import/parse-scheduled-date';
import { resolveImportDatesWithAI } from '@/lib/import/resolve-import-dates';
import { resolveImportPostcodesWithAI } from '@/lib/import/resolve-import-postcodes';
import { resolveImportJobLengthsWithAI } from '@/lib/import/resolve-import-job-lengths';
import { summarizeJobDescriptionsBatch } from '@/lib/import/summarize-job-description';
import {
  collectJobLengthsNeedingAi,
  collectPostcodesNeedingAi,
  prepareImportRows,
  areCoreColumnsMapped,
  type ImportResolveMaps,
} from '@/lib/import/prepare-import-rows';

/** Insert batch size (total import is unlimited; we chunk inserts for DB safety). */
const BATCH_SIZE = 100;
/** Process 10 jobs at a time for AI skill detection to avoid rate limits. */
const SKILL_DETECT_BATCH_SIZE = 10;
const SKILL_DETECT_DELAY_MS = 300;
const GEOCODE_BATCH_SIZE = 5;
const GEOCODE_DELAY_MS = 300;

const AUTO_ASSIGN_CONCURRENCY = 5;

export type ImportJobsResult =
  | {
      success: true;
      count: number;
      assignedCount: number;
      unassignedCount: number;
      errors?: string[];
    }
  | { success: false; error: string; errors?: string[] };

/** Strip ephemeral keys (e.g. _fullAddress) that must never be sent to PostgREST. */
function toJobInsertRow(job: Record<string, unknown>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(job)) {
    if (key.startsWith('_')) continue;
    row[key] = value;
  }
  return row;
}

function uniquifyReferenceNumber(
  preferred: string,
  used: Set<string>,
  counter: number
): string {
  let candidate = preferred.trim();
  if (!candidate) {
    candidate = `IMP-${Date.now()}-${counter}`;
  }
  if (!used.has(candidate.toLowerCase())) {
    used.add(candidate.toLowerCase());
    return candidate;
  }
  let n = 0;
  let unique = '';
  do {
    n += 1;
    unique = `${candidate}-${n}`;
  } while (used.has(unique.toLowerCase()));
  used.add(unique.toLowerCase());
  return unique;
}

export async function importJobs(params: {
  customerId: string;
  columnMapping: Record<string, string>;
  valueTransforms?: Record<string, Record<string, string>>;
  csvData: Record<string, string>[];
  csvHeaders?: string[];
  fileName?: string;
  /** When true (default), auto-assign imported jobs to workers. */
  /** When true (default), auto-assign imported jobs to workers. */
  autoAllocate?: boolean;
  /**
   * When false (default), any invalid row blocks the whole import.
   * When true, valid rows import and invalid ones are skipped.
   */
  allowPartialImport?: boolean;
  /**
   * Resolve maps from preview (raw → cleaned). Import reuses these so Review
   * matches write; AI only runs again for leftovers.
   */
  preResolvedDates?: Record<string, string>;
  preResolvedPostcodes?: Record<string, string>;
  preResolvedJobLengths?: Record<string, 'half_day' | 'full_day'>;
}): Promise<ImportJobsResult> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user?.id) {
      return { success: false, error: 'Not authenticated' };
    }

    const { data: userRow } = await supabase
      .from('users')
      .select('tenant_id')
      .eq('id', user.id)
      .single();
    const tenantId = userRow?.tenant_id;
    if (!tenantId) {
      return { success: false, error: 'No tenant assigned.' };
    }

    const customerId = params.customerId?.trim();
    if (!customerId) {
      return { success: false, error: 'Select a customer before importing.' };
    }

    const { data: customerRow, error: customerErr } = await supabase
      .from('customers')
      .select('id, name')
      .eq('id', customerId)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (customerErr || !customerRow) {
      return { success: false, error: 'Customer not found.' };
    }

    const tenantSkillRows = await getTenantSkillsById(tenantId);
    const tenantSkillsForDetect = tenantSkillRows.map(({ key, label }) => ({
      key,
      label,
    }));

    // Internal import_sources row per customer (FK for jobs / AI logs / batches).
    // Mapping on this row is only updated after a successful import — same as customers.import_*.
    const { data: existingSource } = await supabase
      .from('import_sources')
      .select('id, times_used')
      .eq('tenant_id', tenantId)
      .eq('customer_id', customerId)
      .eq('is_active', true)
      .order('last_used_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    let resolvedSourceId: string | null = existingSource?.id ?? null;
    const priorTimesUsed = existingSource?.times_used ?? 0;

    if (!resolvedSourceId) {
      const { data: newSource, error: insErr } = await supabase
        .from('import_sources')
        .insert({
          tenant_id: tenantId,
          source_name: customerRow.name,
          column_mapping: {},
          value_transforms: {},
          customer_id: customerId,
          mapped_by: 'ai',
          times_used: 0,
          last_used_at: new Date().toISOString(),
        })
        .select('id')
        .single();
      if (insErr) {
        console.error('[importJobs] insert import_sources', insErr);
        return {
          success: false,
          error: insErr.message ?? 'Could not start import.',
        };
      }
      resolvedSourceId = newSource?.id ?? null;
    }

    const map = params.columnMapping;
    const transforms = params.valueTransforms ?? {};

    if (!areCoreColumnsMapped(map)) {
      return {
        success: false,
        error: 'Map Address and Postcode before importing.',
      };
    }

    const { data: existingRefRows } = await supabase
      .from('jobs')
      .select('reference_number')
      .eq('tenant_id', tenantId);
    const usedReferenceNumbers = new Set(
      (existingRefRows ?? [])
        .map((r: { reference_number: string | null }) => r.reference_number?.trim().toLowerCase())
        .filter((r): r is string => !!r)
    );

    const jobs: Record<string, unknown>[] = [];
    const errors: string[] = [];
    let refCounter = 0;
    const dateMapped = isScheduledDateMapped(map);

    // Same resolve pipeline as preview: start from pre-resolved maps, AI only leftovers.
    const resolveMaps: ImportResolveMaps = {
      dates: { ...(params.preResolvedDates ?? {}) },
      postcodes: { ...(params.preResolvedPostcodes ?? {}) },
      jobLengths: { ...(params.preResolvedJobLengths ?? {}) },
    };

    if (dateMapped) {
      const dateCol = map.scheduled_date;
      const stillUnparsed = collectUnparsedDateValues(params.csvData, dateCol).filter(
        (raw) => !applyResolvedDate(raw, resolveMaps.dates)
      );
      if (stillUnparsed.length > 0) {
        const extra = await resolveImportDatesWithAI(stillUnparsed, resolvedSourceId);
        resolveMaps.dates = { ...resolveMaps.dates, ...extra };
      }
    }

    const postcodesNeedingAi = collectPostcodesNeedingAi(
      params.csvData,
      map,
      transforms
    ).filter((raw) => !resolveMaps.postcodes[raw]);
    if (postcodesNeedingAi.length > 0) {
      const extra = await resolveImportPostcodesWithAI(postcodesNeedingAi, resolvedSourceId);
      resolveMaps.postcodes = { ...resolveMaps.postcodes, ...extra };
    }

    const lengthsNeedingAi = collectJobLengthsNeedingAi(
      params.csvData,
      map,
      transforms
    ).filter((raw) => !resolveMaps.jobLengths[raw]);
    if (lengthsNeedingAi.length > 0) {
      const extra = await resolveImportJobLengthsWithAI(lengthsNeedingAi, resolvedSourceId);
      resolveMaps.jobLengths = { ...resolveMaps.jobLengths, ...extra };
    }

    // Shared prepare = same rules as Review preview.
    const prepared = prepareImportRows(params.csvData, map, transforms, resolveMaps, {
      absoluteFieldsReady: true,
    });

    const invalidPrepared = prepared.filter((row) => !row.ok);
    if (invalidPrepared.length > 0 && params.allowPartialImport !== true) {
      return {
        success: false,
        error: `${invalidPrepared.length} row${invalidPrepared.length === 1 ? '' : 's'} still have issues. Fix the spreadsheet and re-import, or opt in to a partial import.`,
        errors: invalidPrepared.map((row) => `Row ${row.rowIndex + 1}: ${row.errors.join('; ')}`),
      };
    }

    const descriptionInputs: Array<{
      mappedDescription: string;
      unmappedAppendix: string;
      address: string;
      descriptionFallback: string;
    }> = [];

    for (const row of prepared) {
      if (!row.ok) {
        errors.push(`Row ${row.rowIndex + 1}: ${row.errors.join('; ')}`);
        descriptionInputs.push({
          mappedDescription: '',
          unmappedAppendix: '',
          address: '',
          descriptionFallback: '',
        });
        continue;
      }

      descriptionInputs.push({
        mappedDescription: row.mappedDescription,
        unmappedAppendix: row.unmappedAppendix,
        address: row.address,
        descriptionFallback: row.descriptionFallback,
      });

      refCounter += 1;
      const preferredRef = row.referenceNumber || `IMP-${Date.now()}-${refCounter}`;
      const referenceNumber = uniquifyReferenceNumber(
        preferredRef,
        usedReferenceNumbers,
        refCounter
      );

      const fullAddress = buildFullAddressString([row.address, row.postcode]);

      jobs.push({
        tenant_id: tenantId,
        import_source_id: resolvedSourceId,
        reference_number: referenceNumber,
        customer_id: customerId,
        address: row.address,
        postcode: row.postcode,
        job_description: row.descriptionFallback,
        source_fields: row.sourceFields,
        status: 'pending',
        priority: row.priority,
        job_length: row.jobLength,
        scheduled_date: row.scheduledDate,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        required_skills: [] as string[],
        lat: null,
        lng: null,
        _description: row.descriptionFallback,
        _address: row.address,
        _priority: row.priority,
        _fullAddress: fullAddress,
        _descIndex: descriptionInputs.length - 1,
      });
    }

    // If a date column was mapped and every row failed, fail the import clearly.
    if (dateMapped && jobs.length === 0 && params.csvData.length > 0) {
      return {
        success: false,
        error:
          errors[0] ??
          'Scheduled date is mapped but no rows had a usable date. Fix the date column or unmap it.',
        errors: errors.length ? errors : undefined,
      };
    }

    // AI description summaries (fallback = mapped notes only — extras stay in source_fields).
    const summaryTargets = jobs.map((job) => {
      const idx = (job as Record<string, unknown>)._descIndex as number;
      const input = descriptionInputs[idx]!;
      return {
        mappedDescription: input.mappedDescription,
        unmappedAppendix: input.unmappedAppendix,
        address: input.address,
      };
    });
    try {
      const summaries = await summarizeJobDescriptionsBatch(summaryTargets);
      jobs.forEach((job, j) => {
        const record = job as Record<string, unknown>;
        const idx = record._descIndex as number;
        const fallback =
          descriptionInputs[idx]?.descriptionFallback ?? (record._description as string);
        const summary = summaries[j]?.trim();
        const finalDesc = summary || fallback;
        record.job_description = finalDesc;
        record._description = finalDesc;
        delete record._descIndex;
      });
    } catch (e) {
      console.error('[importJobs] description summaries failed', e);
      jobs.forEach((job) => {
        delete (job as Record<string, unknown>)._descIndex;
      });
    }

    try {
      for (let i = 0; i < jobs.length; i += GEOCODE_BATCH_SIZE) {
        const batch = jobs.slice(i, i + GEOCODE_BATCH_SIZE);
        await Promise.all(
          batch.map(async (job) => {
            const record = job as Record<string, unknown>;
            const geocoded = await resolveJobCoordinates({
              postcode: record.postcode as string | null,
              fullAddress: record._fullAddress as string,
            });
            record.lat = geocoded?.lat ?? null;
            record.lng = geocoded?.lng ?? null;
          })
        );
        if (i + GEOCODE_BATCH_SIZE < jobs.length) {
          await new Promise((r) => setTimeout(r, GEOCODE_DELAY_MS));
        }
      }
    } catch (e) {
      console.error('[importJobs] geocoding failed', e);
    }

    try {
      for (let i = 0; i < jobs.length; i += SKILL_DETECT_BATCH_SIZE) {
        const batch = jobs.slice(i, i + SKILL_DETECT_BATCH_SIZE);
        await Promise.all(
          batch.map(async (job) => {
            const { data: skills } = await detectSkills({
              description: (job as Record<string, unknown>)._description as string,
              address: (job as Record<string, unknown>)._address as string,
              priority: (job as Record<string, unknown>)._priority as string,
              tenantSkills: tenantSkillsForDetect,
            });
            (job as Record<string, unknown>).required_skills = skills;
            delete (job as Record<string, unknown>)._description;
            delete (job as Record<string, unknown>)._address;
            delete (job as Record<string, unknown>)._priority;
            delete (job as Record<string, unknown>)._fullAddress;
          })
        );
        if (i + SKILL_DETECT_BATCH_SIZE < jobs.length) {
          await new Promise((r) => setTimeout(r, SKILL_DETECT_DELAY_MS));
        }
      }
    } catch (e) {
      console.error('[importJobs] skill detection failed', e);
    }

    let imported = 0;
    const jobIds: string[] = [];
    const insertedPostcodes = new Map<string, string | null>();
    const startedAt = new Date().toISOString();

    // Always strip ephemeral `_` keys — skill-detect cleanup can be skipped on errors,
    // and leftover `_fullAddress` makes PostgREST reject the entire batch.
    const jobsToInsert = jobs.map((j) => toJobInsertRow(j as Record<string, unknown>));

    for (let i = 0; i < jobsToInsert.length; i += BATCH_SIZE) {
      const batch = jobsToInsert.slice(i, i + BATCH_SIZE);
      const { data: inserted, error } = await supabase
        .from('jobs')
        .insert(batch)
        .select('id, postcode');
      if (error) {
        console.error('[importJobs] batch insert', error);
        errors.push(`Batch at row ${i + 1}: ${error.message}`);
        continue;
      }
      if (inserted) {
        imported += inserted.length;
        inserted.forEach((r: { id: string; postcode: string | null }) => {
          jobIds.push(r.id);
          insertedPostcodes.set(r.id, r.postcode);
        });
      }
    }

    const shouldAutoAllocate = params.autoAllocate !== false;
    let assignedCount = 0;

    if (shouldAutoAllocate && jobIds.length > 0) {
      // Group jobs by site before allocating so several jobs in one building go
      // to the same worker as a single visit. Jobs within a group are allocated
      // sequentially (autoAllocateJobGroup); only separate sites run in parallel,
      // which avoids two concurrent allocations racing for the same building.
      const groups = new Map<string, string[]>();
      for (const id of jobIds) {
        const key = clusterKeyForPostcode(insertedPostcodes.get(id)) ?? `__solo__${id}`;
        const existing = groups.get(key);
        if (existing) existing.push(id);
        else groups.set(key, [id]);
      }

      const groupList = [...groups.values()];
      for (let i = 0; i < groupList.length; i += AUTO_ASSIGN_CONCURRENCY) {
        const chunk = groupList.slice(i, i + AUTO_ASSIGN_CONCURRENCY);
        const results = await Promise.all(chunk.map((ids) => autoAllocateJobGroup(ids)));
        results.forEach((r) => {
          assignedCount += r.assignedCount;
          if (r.failedJobIds.length > 0) {
            console.warn('[importJobs] auto-assign failed for jobs', r.failedJobIds.join(', '));
          }
        });
      }
    }

    const completedAt = new Date().toISOString();
    const durationSeconds = Math.round(
      (new Date(completedAt).getTime() - new Date(startedAt).getTime()) / 1000
    );

    const historyPayload = {
      tenant_id: tenantId,
      import_source_id: resolvedSourceId,
      file_name: params.fileName ?? 'import.csv',
      file_size_bytes: null,
      rows_total: params.csvData.length,
      rows_imported: imported,
      rows_failed: params.csvData.length - imported,
      job_ids: jobIds,
      errors: errors.length ? errors : [],
      imported_by_user_id: user.id,
      started_at: startedAt,
      completed_at: completedAt,
      duration_seconds: durationSeconds,
    };

    // Authenticated INSERT on import_history is blocked by RLS (no INSERT policy).
    // Write via service role after tenant checks; migration adds a proper policy too.
    const { error: historyError } = await createAdminClient()
      .from('import_history')
      .insert(historyPayload);
    if (historyError) {
      console.error('[importJobs] import_history insert', historyError);
      errors.push(`Import history could not be saved: ${historyError.message}`);
    }

    revalidatePath('/jobs');
    revalidatePath('/monitor');
    revalidatePath('/import');
    const unassignedCount = imported - assignedCount;

    if (imported === 0 && params.csvData.length > 0) {
      const detail = errors[0] ?? 'No rows could be imported.';
      return {
        success: false,
        error: `Imported 0 jobs. ${detail}`,
        errors: errors.length ? errors : undefined,
      };
    }

    // Persist mapping only after jobs were actually written.
    const headers =
      params.csvHeaders && params.csvHeaders.length > 0
        ? params.csvHeaders
        : Object.keys(params.csvData[0] ?? {});
    await supabase
      .from('customers')
      .update({
        import_column_mapping: params.columnMapping,
        import_value_transforms: params.valueTransforms ?? {},
        import_expected_headers: headers,
        import_mapping_updated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', customerId)
      .eq('tenant_id', tenantId);

    if (resolvedSourceId) {
      await supabase
        .from('import_sources')
        .update({
          column_mapping: params.columnMapping,
          value_transforms: params.valueTransforms ?? {},
          customer_id: customerId,
          source_name: customerRow.name,
          last_used_at: new Date().toISOString(),
          times_used: priorTimesUsed + 1,
        })
        .eq('id', resolvedSourceId);
    }

    return {
      success: true,
      count: imported,
      assignedCount,
      unassignedCount,
      errors: errors.length ? errors : undefined,
    };
  } catch (e) {
    console.error('[importJobs]', e);
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Import failed',
    };
  }
}
