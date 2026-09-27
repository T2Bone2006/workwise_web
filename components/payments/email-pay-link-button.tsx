'use client';

import { useState } from 'react';
import { Loader2, Mail } from 'lucide-react';
import { toast } from 'sonner';
import { emailPayLink } from '@/lib/actions/payments';
import { Button } from '@/components/ui/button';

export function EmailPayLinkButton({
  customerId,
  available,
  hasEmail,
}: {
  customerId: string;
  available: boolean;
  hasEmail: boolean;
}) {
  const [pending, setPending] = useState(false);

  const handle = async () => {
    setPending(true);
    const result = await emailPayLink({ customerId });
    setPending(false);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success('Pay link emailed');
  };

  if (!hasEmail) return null;

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => void handle()}
      disabled={!available || pending}
    >
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" />}
      Email pay link
    </Button>
  );
}
