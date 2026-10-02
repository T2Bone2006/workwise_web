'use client';

import { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { periodRange } from '@/lib/books/periods';
import { downloadZip } from '@/lib/downloads/client';

export type DownloadAction = {
  key: string;
  label: string;
  primary?: boolean;
  /** Where to fetch it from; `year=` (and `quarter=`) are added. A plain string so a server page can pass it. */
  url: string;
};

function urlFor(action: DownloadAction, startYear: number, quarter: 1 | 2 | 3 | 4 | null): string {
  const join = action.url.includes('?') ? '&' : '?';
  return `${action.url}${join}year=${startYear}${quarter ? `&quarter=${quarter}` : ''}`;
}

const QUARTERS = [
  { n: 1, label: 'Q1: 6 Apr to 5 Jul' },
  { n: 2, label: 'Q2: 6 Jul to 5 Oct' },
  { n: 3, label: 'Q3: 6 Oct to 5 Jan' },
  { n: 4, label: 'Q4: 6 Jan to 5 Apr' },
] as const;

/**
 * Pick a tax year, press a button, get a ZIP. If a year has too many invoices
 * for one download, it offers the four quarters instead of just failing.
 */
export function TaxYearDownload({
  years,
  defaultYear,
  actions,
}: {
  years: number[];
  defaultYear: number;
  actions: DownloadAction[];
}) {
  const [year, setYear] = useState(defaultYear);
  const [busy, setBusy] = useState<string | null>(null);
  const [tooMany, setTooMany] = useState<{ action: DownloadAction; invoiceCount?: number } | null>(null);

  const run = async (action: DownloadAction, quarter: 1 | 2 | 3 | 4 | null) => {
    if (busy) return;
    setBusy(`${action.key}${quarter ?? ''}`);
    setTooMany(null);
    const result = await downloadZip(urlFor(action, year, quarter));
    setBusy(null);
    if (result.ok) {
      toast.success('Download ready');
      return;
    }
    if (result.tooMany) {
      setTooMany({ action, invoiceCount: result.invoiceCount });
      return;
    }
    toast.error(result.error);
  };

  const working = busy != null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={String(year)} onValueChange={(v) => { setYear(Number(v)); setTooMany(null); }}>
          <SelectTrigger className="w-48" aria-label="Tax year">
            <SelectValue>{periodRange({ kind: 'tax_year', startYear: year }).label}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {years.map((y) => (
              <SelectItem key={y} value={String(y)}>
                {periodRange({ kind: 'tax_year', startYear: y }).label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {actions.map((action) => (
          <Button
            key={action.key}
            variant={action.primary ? 'default' : 'outline'}
            disabled={working}
            onClick={() => run(action, null)}
          >
            {busy === action.key ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
            {action.label}
          </Button>
        ))}
      </div>

      {working ? (
        <p className="text-sm text-muted-foreground" role="status">
          Getting your files together. This can take a minute if there are lots of receipts and invoices.
        </p>
      ) : null}

      {tooMany ? (
        <div className="space-y-2 rounded-lg border border-amber-300/70 bg-amber-50/60 p-3 dark:border-amber-400/30 dark:bg-amber-950/20">
          <p className="text-sm">
            {tooMany.invoiceCount != null ? `That year has ${tooMany.invoiceCount} invoices, which is too many for one download.` : 'That year is too big for one download.'}{' '}
            Pick a quarter:
          </p>
          <div className="flex flex-wrap gap-2">
            {QUARTERS.map((q) => (
              <Button key={q.n} variant="outline" size="sm" disabled={working} onClick={() => run(tooMany.action, q.n)}>
                {busy === `${tooMany.action.key}${q.n}` ? <Loader2 className="size-4 animate-spin" /> : null}
                {q.label}
              </Button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
