/** Persist the last Jobs list query so detail → back keeps filters. */

import {
  writeFieldFiltersToSearchParams,
  type FieldFilterPair,
} from '@/lib/jobs/field-filter';

export const JOBS_LIST_QUERY_KEY = 'workwise.jobsListQuery';
export const JOBS_LIST_FILTERS_KEY = 'workwise.jobsListFieldFilters';

export function rememberJobsListQuery(queryString: string): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(JOBS_LIST_QUERY_KEY, queryString);
  } catch {
    // ignore quota / private mode
  }
}

/** Persist query string + committed field filters (filters JSON is source of truth). */
export function rememberJobsListState(
  queryString: string,
  fieldFilters: FieldFilterPair[]
): void {
  if (typeof window === 'undefined') return;
  try {
    const params = new URLSearchParams(queryString);
    writeFieldFiltersToSearchParams(params, fieldFilters);
    sessionStorage.setItem(JOBS_LIST_QUERY_KEY, params.toString());
    sessionStorage.setItem(JOBS_LIST_FILTERS_KEY, JSON.stringify(fieldFilters));
  } catch {
    // ignore quota / private mode
  }
}

export function getRememberedFieldFilters(): FieldFilterPair[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = sessionStorage.getItem(JOBS_LIST_FILTERS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p): p is FieldFilterPair =>
        !!p &&
        typeof p === 'object' &&
        typeof (p as FieldFilterPair).field === 'string' &&
        typeof (p as FieldFilterPair).value === 'string' &&
        !!(p as FieldFilterPair).field.trim() &&
        !!(p as FieldFilterPair).value
    );
  } catch {
    return [];
  }
}

export function getRememberedJobsListHref(): string {
  if (typeof window === 'undefined') return '/jobs';
  try {
    const q = sessionStorage.getItem(JOBS_LIST_QUERY_KEY)?.trim() ?? '';
    const params = new URLSearchParams(q);
    const filters = getRememberedFieldFilters();
    if (filters.length > 0) {
      writeFieldFiltersToSearchParams(params, filters);
    }
    const qs = params.toString();
    return qs ? `/jobs?${qs}` : '/jobs';
  } catch {
    return '/jobs';
  }
}

/** Job detail URL; snapshots the current list query before leaving. */
export function jobDetailHref(
  jobId: string,
  listQueryString?: string,
  fieldFilters?: FieldFilterPair[]
): string {
  if (listQueryString !== undefined) {
    if (fieldFilters) {
      rememberJobsListState(listQueryString, fieldFilters);
    } else {
      rememberJobsListQuery(listQueryString);
    }
  }
  return `/jobs/${jobId}`;
}
