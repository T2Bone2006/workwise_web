'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Loader2, Shield } from 'lucide-react';
import { toast } from 'sonner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { deactivateCustomerPortalAccess } from '@/lib/actions/customers';
import type { CustomerPortalAccessRow } from '@/lib/data/customer-invites';

function formatDate(iso: string | null) {
  if (!iso) return 'Never';
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export interface CustomerPortalAccessTableProps {
  customers: CustomerPortalAccessRow[];
}

export function CustomerPortalAccessTable({ customers }: CustomerPortalAccessTableProps) {
  const router = useRouter();
  const [revokeTarget, setRevokeTarget] = useState<CustomerPortalAccessRow | null>(null);
  const [isRevoking, setIsRevoking] = useState(false);

  const handleRevokeAccess = async () => {
    if (!revokeTarget) return;
    setIsRevoking(true);
    const result = await deactivateCustomerPortalAccess(revokeTarget.id);
    setIsRevoking(false);
    setRevokeTarget(null);
    if (result.success) {
      toast.success('Portal access revoked');
      router.refresh();
    } else {
      toast.error(result.error ?? 'Failed to revoke portal access');
    }
  };

  if (customers.length === 0) {
    return (
      <Card className="glass-card border-border/80">
        <CardContent className="flex min-h-[280px] flex-col items-center justify-center p-8 text-center">
          <div className="mx-auto flex size-14 items-center justify-center rounded-full border border-primary/20 bg-primary/10">
            <Shield className="size-7 text-primary" />
          </div>
          <p className="mt-4 text-sm text-muted-foreground">No customers with portal access</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card className="glass-card overflow-hidden border-border/80">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Last Accessed</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {customers.map((customer) => (
                <TableRow key={customer.id}>
                  <TableCell className="font-medium">
                    <Link
                      href={`/customers/${customer.id}`}
                      className="text-primary hover:underline"
                    >
                      {customer.name || '—'}
                    </Link>
                  </TableCell>
                  <TableCell>
                    {customer.email ? (
                      <a href={`mailto:${customer.email}`} className="text-primary hover:underline">
                        {customer.email}
                      </a>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>{formatDate(customer.portal_last_accessed_at)}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => setRevokeTarget(customer)}
                    >
                      Revoke Access
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!revokeTarget} onOpenChange={(open) => !open && setRevokeTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Revoke portal access</DialogTitle>
            <DialogDescription>
              This will remove this customer&apos;s portal access. They will no longer be able to
              log in. You can reinvite them at any time.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevokeTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleRevokeAccess} disabled={isRevoking}>
              {isRevoking ? <Loader2 className="size-4 animate-spin" /> : null}
              Revoke Access
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
