'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { getPayLink } from '@/lib/actions/payments';
import { Button } from '@/components/ui/button';

export function CopyPayLinkButton({
  customerId,
  available,
}: {
  customerId: string;
  available: boolean;
}) {
  const [pending, setPending] = useState(false);

  const handle = async () => {
    setPending(true);
    const result = await getPayLink(customerId);
    setPending(false);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    try {
      await navigator.clipboard.writeText(result.url);
      toast.success('Pay link copied');
    } catch {
      toast.error('Could not copy the pay link');
    }
  };

  return (
    <Button variant="outline" size="sm" onClick={() => void handle()} disabled={!available || pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : null}
      Copy pay link
    </Button>
  );
}
