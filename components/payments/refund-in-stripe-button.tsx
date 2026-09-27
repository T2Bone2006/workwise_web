'use client';

import { useState } from 'react';
import { ExternalLink, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { openStripeDashboard } from '@/lib/actions/stripe-connect';

/** Opens the connected Stripe Express dashboard (card refunds / disputes live there). */
export function RefundInStripeButton() {
  const [pending, setPending] = useState(false);

  const handle = async () => {
    setPending(true);
    const result = await openStripeDashboard();
    setPending(false);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    window.open(result.url, '_blank', 'noopener,noreferrer');
  };

  return (
    <button
      type="button"
      onClick={() => void handle()}
      disabled={pending}
      className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:underline disabled:opacity-50"
    >
      {pending ? <Loader2 className="size-3 animate-spin" /> : <ExternalLink className="size-3" />}
      Refund in Stripe
    </button>
  );
}
