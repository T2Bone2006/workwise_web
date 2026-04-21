'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { autoAllocateJob } from '@/lib/actions/jobs';
import { detectSkills } from '@/lib/detect-skills';
import { buildFullAddressString, geocodeAddress } from '@/lib/utils/geocoding';

/** Insert batch size (total import is unlimited; we chunk inserts for DB safety). */
const BATCH_SIZE = 100;
/** Process 10 jobs at a time for AI skill detection to avoid rate limits. */
const SKILL_DETECT_BATCH_SIZE = 10;
const SKILL_DETECT_DELAY_MS = 300;
const GEOCODE_BATCH_SIZE = 5;
const GEOCODE_DELAY_MS = 300;
const VALID_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
/** DB enum job_priority may only have low, normal, high - map urgent/emergency to high for insert */
const DB_PRIORITIES = ['low', 'normal', 'high'] as const;
type DbPriority = (typeof DB_PRIORITIES)[number];

const AUTO_ASSIGN_CONCURRENCY = 5;

export type ImportJobsResult =
  | { success: true; count: number; assignedCount: number; unassignedCount: number }
  | { success: false; error: string };

function toPriority(val: unknown): (typeof VALID_PRIORITIES)[number] {
  if (typeof val !== 'string') return 'normal';
  const v = val.toLowerCase().trim();
  if (v === 'emergency') return 'urgent';
  return VALID_PRIORITIES.includes(v as (typeof VALID_PRIORITIES)[number])
    ? (v as (typeof VALID_PRIORITIES)[number])
    : 'normal';
}

/** Map app priority to DB enum value (DB may not have 'urgent', so map to 'high'). */
function toDbPriority(priority: (typeof VALID_PRIORITIES)[number]): DbPriority {
  if (priority === 'urgent') return 'high';
  return priority as DbPriority;
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
        value = t[key] ?? t['default'] ?? value;
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

    const jobs: Record<string, unknown>[] = [];
    const errors: string[] = [];
    let refCounter = 0;

    for (let i = 0; i < params.csvData.length; i++) {
      const row = params.csvData[i]!;
      const address = get(row, 'address');
      const postcode = get(row, 'postcode').replace(/\s/g, '').toUpperCase();
      const description = get(row, 'description');
      const customerName = get(row, 'customer_name');
      const workerName = get(row, 'worker_name');

      const unmappedAppendix = formatUnmappedCsvColumns(row, map);
      const jobDescription =
        description && unmappedAppendix
          ? `${description} | ${unmappedAppendix}`
          : description || unmappedAppendix;

      if (!address || !postcode || !jobDescription) {
        errors.push(
          `Row ${i + 1}: missing address, postcode, or job description (map Description and/or rely on unmapped columns)`
        );
        continue;
      }

      const customerId = customerName
        ? customerByName.get(customerName.toLowerCase()) ?? null
        : null;
      const assignedWorkerId = workerName
        ? workerByName.get(workerName.toLowerCase()) ?? null
        : null;

      // Use CSV value if mapped; otherwise generate unique ref per import run (IMP-<timestamp>-<n>).
      // Same CSV uploaded twice gets a new timestamp each run, so no duplicate reference numbers.
      let referenceNumber = get(row, 'reference_number');
      if (!referenceNumber) {
        refCounter += 1;
        referenceNumber = `IMP-${Date.now()}-${refCounter}`;
      }

      const priority = toPriority(get(row, 'priority') || 'normal');
      const scheduledDate = get(row, 'scheduled_date') || null;
      const fullAddress = buildFullAddressString([address, postcode]);

      jobs.push({
        tenant_id: tenantId,
        import_source_id: resolvedSourceId,
        reference_number: referenceNumber,
        customer_id: customerId,
        assigned_worker_id: assignedWorkerId,
        address,
        postcode: postcode.length >= 5 ? postcode : postcode.padEnd(5, ' '),
        job_description: jobDescription,
        status: 'pending',
        priority: toDbPriority(priority),
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

    for (let i = 0; i < jobs.length; i += GEOCODE_BATCH_SIZE) {
      const batch = jobs.slice(i, i + GEOCODE_BATCH_SIZE);
      await Promise.all(
        batch.map(async (job) => {
          const fullAddress = (job as Record<string, unknown>)._fullAddress as string;
          const geocoded = await geocodeAddress(fullAddress);
          (job as Record<string, unknown>).lat = geocoded?.lat ?? null;
          (job as Record<string, unknown>).lng = geocoded?.lng ?? null;
        })
      );
      if (i + GEOCODE_BATCH_SIZE < jobs.length) {
        await new Promise((r) => setTimeout(r, GEOCODE_DELAY_MS));
      }
    }

    for (let i = 0; i < jobs.length; i += SKILL_DETECT_BATCH_SIZE) {
      const batch = jobs.slice(i, i + SKILL_DETECT_BATCH_SIZE);
      await Promise.all(
        batch.map(async (job) => {
          const { data: skills } = await detectSkills(
            {
              description: (job as Record<string, unknown>)._description as string,
              address: (job as Record<string, unknown>)._address as string,
              priority: (job as Record<string, unknown>)._priority as string,
            }
          );
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

    let imported = 0;
    const jobIds: string[] = [];
    const startedAt = new Date().toISOString();

    const jobsToInsert = jobs.map((j) => {
      const o = j as Record<string, unknown>;
      const { _description, _address, _priority, ...rest } = o;
      return rest;
    });

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

    await supabase.from('import_history').insert({
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
    });

    revalidatePath('/jobs');
    const unassignedCount = imported - assignedCount;
    return { success: true, count: imported, assignedCount, unassignedCount };
  } catch (e) {
    console.error('[importJobs]', e);
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Import failed',
    };
  }
}
