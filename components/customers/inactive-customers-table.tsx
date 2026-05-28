'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Building2, Loader2, User, UserX } from 'lucide-react';
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
import { reactivateCustomer } from '@/lib/actions/customers';
import type { InactiveCustomerRow } from '@/lib/data/customers';
import { cn } from '@/lib/utils';

export interface InactiveCustomersTableProps {
  customers: InactiveCustomerRow[];
}

export function InactiveCustomersTable({ customers }: InactiveCustomersTableProps) {
  const router = useRouter();
  const [reactivateTarget, setReactivateTarget] = useState<InactiveCustomerRow | null>(null);
  const [isReactivating, setIsReactivating] = useState(false);

  const handleReactivate = async () => {
    if (!reactivateTarget) return;
    setIsReactivating(true);
    const result = await reactivateCustomer(reactivateTarget.id);
    setIsReactivating(false);
    setReactivateTarget(null);
    if (result.success) {
      toast.success('Customer reactivated');
      router.refresh();
    } else {
      toast.error(result.error ?? 'Failed to reactivate customer');
    }
  };

  if (customers.length === 0) {
    return (
      <Card className="glass-card border-border/80">
        <CardContent className="flex min-h-[280px] flex-col items-center justify-center p-8 text-center">
          <div className="mx-auto flex size-14 items-center justify-center rounded-full border border-muted bg-muted/30">
            <UserX className="size-7 text-muted-foreground" />
          </div>
          <p className="mt-4 text-sm text-muted-foreground">No inactive customers</p>
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
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {customers.map((customer) => {
                const isBulk = customer.type === 'bulk_client';
                return (
                  <TableRow key={customer.id}>
                    <TableCell className="font-medium">{customer.name}</TableCell>
                    <TableCell>{customer.email ?? '—'}</TableCell>
                    <TableCell>
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium',
                          isBulk
                            ? 'border-violet-400/60 bg-violet-500/10 text-violet-700 dark:text-violet-400'
                            : 'border-emerald-400/60 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                        )}
                      >
                        {isBulk ? <Building2 className="size-3" /> : <User className="size-3" />}
                        {isBulk ? 'Bulk Client' : 'Individual'}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setReactivateTarget(customer)}
                      >
                        Reactivate
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog
        open={!!reactivateTarget}
        onOpenChange={(open) => !open && setReactivateTarget(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reactivate customer</DialogTitle>
            <DialogDescription>
              This will restore {reactivateTarget?.name} as an active customer.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReactivateTarget(null)}>
              Cancel
            </Button>
            <Button onClick={handleReactivate} disabled={isReactivating}>
              {isReactivating ? <Loader2 className="size-4 animate-spin" /> : null}
              Reactivate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
