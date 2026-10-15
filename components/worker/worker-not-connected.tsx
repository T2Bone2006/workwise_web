'use client';

import { Link2Off } from 'lucide-react';
import { EmptyState } from '@/components/look';
import { Button } from '@/components/ui/button';
import { logout } from '@/lib/actions/auth';

/** Shown on every worker page when the login has no live link to an employer. */
export function WorkerNotConnected() {
  return (
    <div className="mx-auto max-w-lg py-10">
      <EmptyState
        icon={Link2Off}
        title="You're not connected to a business"
        body="Ask your manager to invite you again."
        action={
          <Button variant="outline" onClick={() => void logout()}>
            Sign out
          </Button>
        }
      />
    </div>
  );
}
