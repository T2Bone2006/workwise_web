'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { autoAllocateJob } from '@/lib/actions/jobs';
import { statusAfterWorkerAssignment } from '@/lib/jobs/worker-assignment-status';
import { getTenantSkillsById } from '@/lib/actions/skills';
import { detectSkills } from '@/lib/detect-skills';
import { buildFullAddressString, resolveJobCoordinates } from '@/lib/utils/geocoding';
import { normalizeUkPostcode } from '@/lib/utils/postcode';

/** Insert batch size (total import is unlimited; we chunk inserts for DB safety). */
const BATCH_SIZE = 100;
/** Process 10 jobs at a time for AI skill detection to avoid rate limits. */
const SKILL_DETECT_BATCH_SIZE = 10;
const SKILL_DETECT_DELAY_MS = 300;
const GEOCODE_BATCH_SIZE = 5;
const GEOCODE_DELAY_MS = 300;
const VALID_PRIORITIES = ['low', 'normal', 'high', 'emergency'] as const;

const AUTO_ASSIGN_CONCURRENCY = 5;

export type ImportJobsResult =
  | {
      success: true;
      count: number;
      assignedCount: number;
      unassignedCount: number;
      errors?: string[];
    }
  | { success: false; error: string };

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
  // Keep colliding until unique (handles same CSV re-import + in-file dupes).
  let n = 0;
  let unique = '';
  do {
    n += 1;
    unique = `${candidate}-IMP-${Date.now()}-${counter}-${n}`;
  } while (used.has(unique.toLowerCase()));
  used.add(unique.toLowerCase());
  return unique;
}

function toPriority(val: unknown): (typeof VALID_PRIORITIES)[number] {
  if (typeof val !== 'string') return 'normal';
  const v = val.toLowerCase().trim();
  if (v === 'urgent') return 'emergency';
  return VALID_PRIORITIES.includes(v as (typeof VALID_PRIORITIES)[number])
    ? (v as (typeof VALID_PRIORITIES)[number])
    : 'normal';
}

/** YYYY-MM-DD unchanged; DD/MM/YYYY or DD-MM-YYYY → ISO date; unparseable → null. */
function parseImportScheduledDate(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const match = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const d = new Date(`${iso}T00:00:00Z`);
  if (
    Number.isNaN(d.getTime()) ||
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() + 1 !== month ||
    d.getUTCDate() !== day
  ) {
    return null;
  }
  return iso;
}

/** CSV columns not assigned to any schema field, formatted for appending to job_description. */
function formatUnmappedCsvColumns(
  row: Record<string, string>,
  columnMapping: Record<string, string>
): string {
  const mappedCsvHeaders = new Set(
    Object.values(columnMapping).filter((c) => typeof c === 'string' && c.trim() !== '')
  );
  const parts: string[] = [];
  for (const col of Object.keys(row)) {
    if (!col.trim()) continue;
    if (mappedCsvHeaders.has(col)) continue;
    const val = String(row[col] ?? '').trim();
    if (val === '') continue;
    parts.push(`${col}: ${val}`);
  }
  return parts.join(' | ');
}

export async function importJobs(params: {
  sourceId: string | null;
  sourceName: string;
  customerId?: string;
  columnMapping: Record<string, string>;
  valueTransforms?: Record<string, Record<string, string>>;
  csvData: Record<string, string>[];
  fileName?: string;
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

    const tenantSkillRows = await getTenantSkillsById(tenantId);
    const tenantSkillsForDetect = tenantSkillRows.map(({ key, label }) => ({
      key,
      label,
    }));

    let resolvedSourceId: string | null = params.sourceId;

    if (resolvedSourceId) {
      const { data: src } = await supabase
        .from('import_sources')
        .select('times_used')
        .eq('id', resolvedSourceId)
        .single();
      const nextTimesUsed = (src?.times_used ?? 0) + 1;
      await supabase
        .from('import_sources')
        .update({
          column_mapping: params.columnMapping,
          value_transforms: params.valueTransforms ?? {},
          customer_id: params.customerId ?? null,
          last_used_at: new Date().toISOString(),
          times_used: nextTimesUsed,
        })
        .eq('id', resolvedSourceId);
    } else {
      const { data: newSource, error: insErr } = await supabase
        .from('import_sources')
        .insert({
          tenant_id: tenantId,
          source_name: params.sourceName.trim() || 'Unnamed source',
          column_mapping: params.columnMapping,
          value_transforms: params.valueTransforms ?? {},
          customer_id: params.customerId ?? null,
          mapped_by: 'manual',
          times_used: 1,
          last_used_at: new Date().toISOString(),
        })
        .select('id')
        .single();
      if (insErr) {
        console.error('[importJobs] insert import_sources', insErr);
        return { success: false, error: insErr.message ?? 'Failed to create import source' };
      }
      resolvedSourceId = newSource?.id ?? null;
    }

    const map = params.columnMapping;
    const transforms = params.valueTransforms ?? {};
    const get = (row: Record<string, string>, ourField: string): string => {
      const csvCol = map[ourField];
      let value = '';
      if (csvCol && row[csvCol] != null) {
        value = String(row[csvCol]).trim();
      }
      if (transforms[ourField]) {
        const t = transforms[ourField];
        const key = value === '' ? 'default' : value;
        const mapped = t[key] ?? t['default'];
        // "keep" means retain the CSV value (AI mapping sentinel), not replace with the word keep.
        if (mapped != null && mapped !== 'keep') {
          value = mapped;
        }
      }
      return value;
    };

    const customersResult = await supabase
      .from('customers')
      .select('id, name')
      .eq('tenant_id', tenantId)
      .eq('is_active', true);
    const customerByName = new Map<string, string>();
    (customersResult.data ?? []).forEach((c: { id: string; name: string }) => {
      if (c.name) customerByName.set(c.name.trim().toLowerCase(), c.id);
    });

    const workersResult = await supabase
      .from('workers')
      .select('id, full_name')
      .eq('primary_tenant_id', tenantId);
    const workerByName = new Map<string, string>();
    (workersResult.data ?? []).forEach((w: { id: string; full_name: string | null }) => {
      if (w.full_name) workerByName.set(w.full_name.trim().toLowerCase(), w.id);
    });

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

    for (let i = 0; i < params.csvData.length; i++) {
      const row = params.csvData[i]!;
      const address = get(row, 'address');
      const rawPostcode = get(row, 'postcode');
      const postcode = normalizeUkPostcode(rawPostcode) ?? '';
      const description = get(row, 'description');
      const customerName = get(row, 'customer_name');
      const workerName = get(row, 'worker_name');

      const unmappedAppendix = formatUnmappedCsvColumns(row, map);
      const jobDescription =
        description && unmappedAppendix
          ? `${description} | ${unmappedAppendix}`
          : description || unmappedAppendix;

      if (!address || !jobDescription) {
        errors.push(
          `Row ${i + 1}: missing address or job description (map Description and/or rely on unmapped columns)`
        );
        continue;
      }
      if (!postcode) {
        errors.push(
          `Row ${i + 1}: invalid UK postcode "${rawPostcode}" (expected e.g. M1 1AE)`
        );
        continue;
      }

      const customerId = params.customerId
        ? params.customerId
        : customerName
          ? customerByName.get(customerName.toLowerCase()) ?? null
          : null;
      const assignedWorkerId = workerName
        ? workerByName.get(workerName.toLowerCase()) ?? null
        : null;

      // Prefer CSV ref when mapped; uniquify against tenant + in-file duplicates
      // (unique index idx_jobs_tenant_reference rejects the whole batch otherwise).
      refCounter += 1;
      const preferredRef = get(row, 'reference_number') || `IMP-${Date.now()}-${refCounter}`;
      const referenceNumber = uniquifyReferenceNumber(
        preferredRef,
        usedReferenceNumbers,
        refCounter
      );

      const priority = toPriority(get(row, 'priority') || 'normal');
      let scheduledDate = get(row, 'scheduled_date') || null;
      scheduledDate = parseImportScheduledDate(scheduledDate);
      const fullAddress = buildFullAddressString([address, postcode]);

      jobs.push({
        tenant_id: tenantId,
        import_source_id: resolvedSourceId,
        reference_number: referenceNumber,
        customer_id: customerId,
        assigned_worker_id: assignedWorkerId,
        address,
        postcode,
        job_description: jobDescription,
        status: assignedWorkerId ? statusAfterWorkerAssignment('pending') : 'pending',
        priority,
        scheduled_date: scheduledDate || null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        required_skills: [] as string[],
        lat: null,
        lng: null,
        _description: jobDescription,
        _address: address,
        _priority: priority,
        _fullAddress: fullAddress,
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
    const startedAt = new Date().toISOString();

    // Always strip ephemeral `_` keys — skill-detect cleanup can be skipped on errors,
    // and leftover `_fullAddress` makes PostgREST reject the entire batch.
    const jobsToInsert = jobs.map((j) => toJobInsertRow(j as Record<string, unknown>));

    for (let i = 0; i < jobsToInsert.length; i += BATCH_SIZE) {
      const batch = jobsToInsert.slice(i, i + BATCH_SIZE);
      const { data: inserted, error } = await supabase
        .from('jobs')
        .insert(batch)
        .select('id');
      if (error) {
        console.error('[importJobs] batch insert', error);
        errors.push(`Batch at row ${i + 1}: ${error.message}`);
        continue;
      }
      if (inserted) {
        imported += inserted.length;
        inserted.forEach((r: { id: string }) => jobIds.push(r.id));
      }
    }

    let assignedCount = 0;
    for (let i = 0; i < jobIds.length; i += AUTO_ASSIGN_CONCURRENCY) {
      const chunk = jobIds.slice(i, i + AUTO_ASSIGN_CONCURRENCY);
      const results = await Promise.all(chunk.map((id) => autoAllocateJob(id)));
      results.forEach((r, idx) => {
        if (r.success) assignedCount += 1;
        else
          console.warn(
            '[importJobs] auto-assign failed for job',
            chunk[idx],
            ':',
            r.error ?? 'unknown'
          );
      });
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
    const unassignedCount = imported - assignedCount;

    if (imported === 0 && params.csvData.length > 0) {
      const detail = errors[0] ?? 'No rows could be imported.';
      return {
        success: false,
        error: `Imported 0 jobs. ${detail}`,
      };
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
