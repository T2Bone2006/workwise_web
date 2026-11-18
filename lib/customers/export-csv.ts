/** The customers export file. Pure, so the table and the tests share one definition. */

export interface CustomerExportRow {
  id: string;
  name: string;
  type: string;
  email: string | null;
  phone: string | null;
  job_count: number;
}

export const CUSTOMER_EXPORT_HEADERS = ['Name', 'Type', 'Email', 'Phone', 'Total Jobs'] as const;

function cell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export function customersToCsv(rows: CustomerExportRow[]): string {
  const lines = rows.map((c) =>
    [c.name, c.type, c.email ?? '', c.phone ?? '', String(c.job_count ?? 0)].map(cell).join(','),
  );
  return [CUSTOMER_EXPORT_HEADERS.join(','), ...lines].join('\n');
}

/** What the table keeps for a ticked customer, so the export still works after the page changes. */
export function toExportRow(c: {
  id: string;
  name: string;
  type: string;
  email?: string | null;
  phone?: string | null;
  job_count?: number;
}): CustomerExportRow {
  return {
    id: c.id,
    name: c.name,
    type: c.type,
    email: c.email ?? null,
    phone: c.phone ?? null,
    job_count: c.job_count ?? 0,
  };
}

export interface SelectionSummary {
  total: number;
  onThisPage: number;
  onOtherPages: number;
}

export function summariseSelection(selectedIds: Iterable<string>, pageIds: string[]): SelectionSummary {
  const page = new Set(pageIds);
  let total = 0;
  let onThisPage = 0;
  for (const id of selectedIds) {
    total += 1;
    if (page.has(id)) onThisPage += 1;
  }
  return { total, onThisPage, onOtherPages: total - onThisPage };
}
