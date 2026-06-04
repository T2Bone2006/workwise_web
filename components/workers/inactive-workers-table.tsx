'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, UserX } from 'lucide-react';
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
import { reactivateWorker } from '@/lib/actions/workers';
import type { DeactivatedWorkerRow } from '@/lib/data/worker-invites';
import { WORKER_TYPE_LABELS } from '@/lib/types/worker';

export interface InactiveWorkersTableProps {
  workers: DeactivatedWorkerRow[];
}

export function InactiveWorkersTable({ workers }: InactiveWorkersTableProps) {
  const router = useRouter();
  const [reactivateTarget, setReactivateTarget] = useState<DeactivatedWorkerRow | null>(null);
  const [isReactivating, setIsReactivating] = useState(false);

  const handleReactivate = async () => {
    if (!reactivateTarget) return;
    setIsReactivating(true);
    const result = await reactivateWorker(reactivateTarget.id);
    setIsReactivating(false);
    setReactivateTarget(null);
    if (result.success) {
      toast.success('Worker reactivated');
      router.refresh();
    } else {
      toast.error(result.error ?? 'Failed to reactivate worker');
    }
  };

  if (workers.length === 0) {
    return (
      <Card className="glass-card border-border/80">
        <CardContent className="flex min-h-[280px] flex-col items-center justify-center p-8 text-center">
          <div className="mx-auto flex size-14 items-center justify-center rounded-full border border-muted bg-muted/30">
            <UserX className="size-7 text-muted-foreground" />
          </div>
          <p className="mt-4 text-sm text-muted-foreground">No inactive workers</p>
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
              {workers.map((worker) => (
                <TableRow key={worker.id}>
                  <TableCell className="font-medium">{worker.full_name}</TableCell>
                  <TableCell>{worker.email ?? '—'}</TableCell>
                  <TableCell>
                    {worker.worker_type
                      ? WORKER_TYPE_LABELS[worker.worker_type]
                      : '—'}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setReactivateTarget(worker)}
                    >
                      Reactivate
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
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
            <DialogTitle>Reactivate worker</DialogTitle>
            <DialogDescription>
              This will restore {reactivateTarget?.full_name}&apos;s access to WorkWise.
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
