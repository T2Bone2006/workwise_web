'use client';

import { useEffect, useState } from 'react';
import { ExternalLink, Loader2 } from 'lucide-react';
import { getReceiptUrl } from '@/lib/actions/expenses';

/** The receipt photo (or a link for a PDF), fetched as a 5-minute signed link. */
export function ReceiptViewer({ expenseId }: { expenseId: string }) {
  const [state, setState] = useState<
    { status: 'loading' } | { status: 'error'; error: string } | { status: 'ready'; url: string; isPdf: boolean }
  >({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    getReceiptUrl({ expenseId }).then((result) => {
      if (cancelled) return;
      if (!result.success) {
        setState({ status: 'error', error: result.error });
        return;
      }
      const isPdf = new URL(result.url).pathname.toLowerCase().endsWith('.pdf');
      setState({ status: 'ready', url: result.url, isPdf });
    });
    return () => {
      cancelled = true;
    };
  }, [expenseId]);

  if (state.status === 'loading') {
    return (
      <div className="flex h-48 items-center justify-center rounded-lg border border-dashed text-muted-foreground">
        <Loader2 className="size-5 animate-spin" aria-label="Loading receipt" />
      </div>
    );
  }
  if (state.status === 'error') {
    return <p className="text-sm text-destructive">{state.error}</p>;
  }
  if (state.isPdf) {
    return (
      <a
        href={state.url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-2 rounded-lg border px-4 py-3 text-sm font-medium hover:bg-muted"
      >
        <ExternalLink className="size-4" /> Open PDF
      </a>
    );
  }
  return (
    <a href={state.url} target="_blank" rel="noreferrer" title="Open full size">
      {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL */}
      <img
        src={state.url}
        alt="Receipt"
        className="max-h-[60vh] w-full rounded-lg border object-contain bg-muted/30"
      />
    </a>
  );
}
