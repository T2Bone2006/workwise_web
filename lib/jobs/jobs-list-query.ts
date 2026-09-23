/** Persist the last Jobs list query so detail → back keeps filters. */

import {
  writeFieldFiltersToSearchParams,
  type FieldFilterPair,
} from '@/lib/jobs/field-filter';

export const JOBS_LIST_QUERY_KEY = 'workwise.jobsListQuery';
export const JOBS_LIST_FILTERS_KEY = 'workwise.jobsListFieldFilters';
export const PORTAL_JOBS_LIST_QUERY_KEY = 'workwise.portalJobsListQuery';
export const PORTAL_JOBS_LIST_FILTERS_KEY = 'workwise.portalJobsListFieldFilters';

function parseRememberedFieldFilters(storageKey: string): FieldFilterPair[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = sessionStorage.getItem(storageKey);
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

function rememberListState(
  queryKey: string,
  filtersKey: string,
  queryString: string,
  fieldFilters: FieldFilterPair[]
): void {
  if (typeof window === 'undefined') return;
  try {
    const params = new URLSearchParams(queryString);
    writeFieldFiltersToSearchParams(params, fieldFilters);
    sessionStorage.setItem(queryKey, params.toString());
    sessionStorage.setItem(filtersKey, JSON.stringify(fieldFilters));
  } catch {
    // ignore quota / private mode
  }
}

function rememberedListHref(
  queryKey: string,
  filtersKey: string,
  basePath: string
): string {
  if (typeof window === 'undefined') return basePath;
  try {
    const q = sessionStorage.getItem(queryKey)?.trim() ?? '';
    const params = new URLSearchParams(q);
    const filters = parseRememberedFieldFilters(filtersKey);
    if (filters.length > 0) {
      writeFieldFiltersToSearchParams(params, filters);
    }
    const qs = params.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  } catch {
    return basePath;
  }
}

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
  rememberListState(JOBS_LIST_QUERY_KEY, JOBS_LIST_FILTERS_KEY, queryString, fieldFilters);
}

export function rememberPortalJobsListState(
  queryString: string,
  fieldFilters: FieldFilterPair[]
): void {
  rememberListState(
    PORTAL_JOBS_LIST_QUERY_KEY,
    PORTAL_JOBS_LIST_FILTERS_KEY,
    queryString,
    fieldFilters
  );
}

export function getRememberedFieldFilters(): FieldFilterPair[] {
  return parseRememberedFieldFilters(JOBS_LIST_FILTERS_KEY);
}

export function getRememberedJobsListHref(): string {
  return rememberedListHref(JOBS_LIST_QUERY_KEY, JOBS_LIST_FILTERS_KEY, '/jobs');
}

export function getRememberedPortalJobsListHref(): string {
  return rememberedListHref(
    PORTAL_JOBS_LIST_QUERY_KEY,
    PORTAL_JOBS_LIST_FILTERS_KEY,
    '/portal'
  );
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

/** Portal job detail URL; snapshots portal list filters for back navigation. */
export function portalJobDetailHref(
  jobId: string,
  listQueryString?: string,
  fieldFilters?: FieldFilterPair[]
): string {
  if (listQueryString !== undefined && fieldFilters) {
    rememberPortalJobsListState(listQueryString, fieldFilters);
  } else if (listQueryString !== undefined) {
    rememberPortalJobsListState(listQueryString, []);
  }
  return `/portal/jobs/${jobId}`;
}
