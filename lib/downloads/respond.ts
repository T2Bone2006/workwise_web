import { NextResponse } from 'next/server';
import { zipFiles, type ZipFile } from '@/lib/downloads/zip';

const slug = (s: string) =>
  s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'business';

export function zipFilename(business: string, suffix: string | null, today: string): string {
  return `workwise-${slug(business)}${suffix ? `-${suffix}` : ''}-${today}.zip`;
}

/** The ZIP as a download. Never cached: it is somebody's books. */
export function zipResponse(files: ZipFile[], filename: string): NextResponse {
  const bytes = zipFiles(files);
  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}

export function jsonError(error: string, status: number, extra: Record<string, unknown> = {}): NextResponse {
  return NextResponse.json({ error, ...extra }, { status, headers: { 'Cache-Control': 'no-store' } });
}

/** ?year=2026&quarter=1 → a tax-year start year and an optional quarter, or null when they are not sensible. */
export function parseYearQuarter(
  params: URLSearchParams,
): { startYear: number; quarter: 1 | 2 | 3 | 4 | null } | null {
  const year = Number(params.get('year'));
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return null;
  const rawQuarter = params.get('quarter');
  if (rawQuarter == null || rawQuarter === '') return { startYear: year, quarter: null };
  const quarter = Number(rawQuarter);
  if (![1, 2, 3, 4].includes(quarter)) return null;
  return { startYear: year, quarter: quarter as 1 | 2 | 3 | 4 };
}

export const TOO_MANY = 'Too many for one download — pick a quarter.';
