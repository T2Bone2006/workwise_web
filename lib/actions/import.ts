'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { autoAllocateJobGroup } from '@/lib/actions/jobs';
import { clusterKeyForPostcode } from '@/lib/jobs/assignment-ranking';
import { getTenantSkillsById } from '@/lib/actions/skills';
import { detectSkillsBatch } from '@/lib/jobs/detect-skills-batch';
import { buildFullAddressString, resolveJobCoordinates } from '@/lib/utils/geocoding';
import {
  descriptionForInsert,
  prepareExtractedRow,
  type ExtractedJobRow,
  type RowEdits,
} from '@/lib/import/extracted-job-row';

/** Insert batch size (total import is unlimited; we chunk inserts for DB safety). */
const BATCH_SIZE = 100;
/** Jobs per skill-detection AI call (one call per batch, not per job). */
const SKILL_DETECT_BATCH_SIZE = 20;
const SKILL_DETECT_DELAY_MS = 300;
const GEOCODE_BATCH_SIZE = 5;
const GEOCODE_DELAY_MS = 300;

const AUTO_ASSIGN_CONCURRENCY = 5;

/** An imported job that could not be auto-allocated, with the reason why. */
export type ImportAllocationFailure = {
  reference: string;
  address: string;
  postcode: string;
  reason: string;
};

export type ImportJobsResult =
  | {
      success: true;
      count: number;
      assignedCount: number;
      unassignedCount: number;
      errors?: string[];
      /** Populated when auto-allocate ran and some jobs could not be assigned. */
      allocationFailures?: ImportAllocationFailure[];
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
  /** AI-extracted rows from the preview step (re-validated here, never trusted as-is). */
  extractedRows: ExtractedJobRow[];
  /** Raw spreadsheet rows, index-aligned with the sheet — kept for source_fields. */
  csvData: Record<string, string>[];
  /** Inline corrections the user made on failed preview rows, keyed by row index. */
  rowEdits?: Record<number, RowEdits>;
  fileName?: string;
  /** When true (default), auto-assign imported jobs to workers. */
  autoAllocate?: boolean;
  /**
   * When false (default), any invalid row blocks the whole import.
   * When true, valid rows import and invalid ones are skipped.
   */
  allowPartialImport?: boolean;
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

    if (params.extractedRows.length === 0) {
      return { success: false, error: 'Nothing to import.' };
    }

    const tenantSkillRows = await getTenantSkillsById(tenantId);
    const tenantSkillsForDetect = tenantSkillRows.map(({ key, label }) => ({
      key,
      label,
    }));

    // Internal import_sources row per customer (FK for jobs / AI logs / batches).
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

    const { data: existingRefRows } = await supabase
      .from('jobs')
      .select('reference_number')
      .eq('tenant_id', tenantId);
    const usedReferenceNumbers = new Set(
      (existingRefRows ?? [])
        .map((r: { reference_number: string | null }) => r.reference_number?.trim().toLowerCase())
        .filter((r): r is string => !!r)
    );

    // Re-validate every AI-extracted row server-side. The preview ran the same
    // rules client-side, but nothing reaches the database on the client's word.
    const edits = params.rowEdits ?? {};
    const prepared = params.extractedRows.map((extracted) =>
      prepareExtractedRow(
        extracted,
        params.csvData[extracted.row_index] ?? {},
        edits[extracted.row_index] ?? {}
      )
    );

    const invalidPrepared = prepared.filter((row) => !row.ok);
    if (invalidPrepared.length > 0 && params.allowPartialImport !== true) {
      return {
        success: false,
        error: `${invalidPrepared.length} row${invalidPrepared.length === 1 ? '' : 's'} still have issues. Fix them in the preview, or opt in to a partial import.`,
        errors: invalidPrepared.map((row) => `Row ${row.rowIndex + 1}: ${row.errors.join('; ')}`),
      };
    }

    const jobs: Record<string, unknown>[] = [];
    const errors: string[] = [];
    let refCounter = 0;

    for (const row of prepared) {
      if (!row.ok) {
        errors.push(`Row ${row.rowIndex + 1}: ${row.errors.join('; ')}`);
        continue;
      }

      refCounter += 1;
      const referenceNumber = uniquifyReferenceNumber(
        row.referenceNumber || `IMP-${Date.now()}-${refCounter}`,
        usedReferenceNumbers,
        refCounter
      );
      const description = descriptionForInsert(row);

      jobs.push({
        tenant_id: tenantId,
        import_source_id: resolvedSourceId,
        reference_number: referenceNumber,
        customer_id: customerId,
        address: row.address,
        postcode: row.postcode,
        job_description: description,
        source_fields: row.sourceFields,
        status: 'pending',
        priority: row.priority,
        job_length: row.jobLength,
        scheduled_date: row.scheduledDate,
        scheduled_time: row.startTime,
        end_time: row.endTime,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        required_skills: [] as string[],
        lat: null,
        lng: null,
        _description: description,
        _address: row.address,
        _priority: row.priority,
        _fullAddress: buildFullAddressString([row.address, row.postcode]),
      });
    }

    if (jobs.length === 0) {
      return {
        success: false,
        error: errors[0] ?? 'No rows could be imported.',
        errors: errors.length ? errors : undefined,
      };
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

    // Skill detection stays its own step: it matches a job against THIS tenant's
    // skill vocabulary, which the extraction call never sees. One call per batch
    // of jobs — not one per job — so the vocabulary is sent once per batch.
    try {
      for (let i = 0; i < jobs.length; i += SKILL_DETECT_BATCH_SIZE) {
        const batch = jobs.slice(i, i + SKILL_DETECT_BATCH_SIZE);
        const skillsPerJob = await detectSkillsBatch({
          supabase,
          tenantId,
          tenantSkills: tenantSkillsForDetect,
          importSourceId: resolvedSourceId,
          jobs: batch.map((job) => {
            const record = job as Record<string, unknown>;
            return {
              description: record._description as string,
              address: record._address as string,
              priority: record._priority as string,
            };
          }),
        });
        batch.forEach((job, j) => {
          (job as Record<string, unknown>).required_skills = skillsPerJob[j] ?? [];
        });
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

    // Always strip ephemeral `_` keys — leftover `_fullAddress` makes PostgREST
    // reject the entire batch.
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
    const failedAllocationIds: string[] = [];

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
            failedAllocationIds.push(...r.failedJobIds);
            console.warn('[importJobs] auto-assign failed for jobs', r.failedJobIds.join(', '));
          }
        });
      }
    }

    // autoAllocate* already persisted a per-job reason; read them back so the
    // import result can say WHY a job is unassigned, not just how many are.
    const allocationFailures: ImportAllocationFailure[] = [];
    if (failedAllocationIds.length > 0) {
      const { data: failedRows } = await supabase
        .from('jobs')
        .select('reference_number, address, postcode, auto_assign_failure_reason')
        .in('id', failedAllocationIds);
      for (const row of failedRows ?? []) {
        allocationFailures.push({
          reference: row.reference_number ?? '',
          address: row.address ?? '',
          postcode: row.postcode ?? '',
          reason: row.auto_assign_failure_reason ?? 'No eligible worker found',
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
    // Write via service role after tenant checks.
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

    if (imported === 0) {
      const detail = errors[0] ?? 'No rows could be imported.';
      return {
        success: false,
        error: `Imported 0 jobs. ${detail}`,
        errors: errors.length ? errors : undefined,
      };
    }

    if (resolvedSourceId) {
      await supabase
        .from('import_sources')
        .update({
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
      allocationFailures: allocationFailures.length ? allocationFailures : undefined,
    };
  } catch (e) {
    console.error('[importJobs]', e);
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Import failed',
    };
  }
}
