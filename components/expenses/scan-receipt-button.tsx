'use client';

import { useRef, useState, type DragEvent } from 'react';
import { Camera, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { scanReceipt } from '@/lib/actions/expenses';
import {
  convertHeicToJpeg,
  decideReceiptFile,
  HEIC_FAILED,
  shrinkPhoto,
  SHRINK_ABOVE_BYTES,
} from '@/lib/expenses/receipt-file';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type ScanOutcome = { expenseId: string; read: 'read' | 'unreadable' | 'not_a_receipt' };

/**
 * Scan a receipt: choose files or drop them on the strip. Several at once are
 * scanned one after another; onScanned gets the last one that worked.
 */
export function ScanReceiptButton({ onScanned }: { onScanned: (last: ScanOutcome) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const busy = progress != null;

  const scanAll = async (files: File[]) => {
    if (files.length === 0 || busy) return;
    let last: ScanOutcome | null = null;
    for (let i = 0; i < files.length; i += 1) {
      setProgress({ done: i, total: files.length });
      const original = files[i];
      const decision = decideReceiptFile(original);
      if (decision.action === 'refuse') {
        toast.error(decision.message);
        continue;
      }
      let file = original;
      if (decision.action === 'convert') {
        const converted = await convertHeicToJpeg(original);
        if (!converted) {
          toast.error(HEIC_FAILED);
          continue;
        }
        file = converted;
      }
      if (decision.action === 'shrink' || (decision.action === 'convert' && file.size > SHRINK_ABOVE_BYTES)) {
        file = await shrinkPhoto(file);
      }

      const formData = new FormData();
      formData.set('file', file);
      formData.set('clientMutationId', crypto.randomUUID());
      try {
        const result = await scanReceipt(formData);
        if (result.success) last = { expenseId: result.expenseId, read: result.read };
        else toast.error(result.error);
      } catch {
        toast.error("Couldn't save that. Try again.");
      }
    }
    setProgress(null);
    if (inputRef.current) inputRef.current.value = '';
    if (last) onScanned(last);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    void scanAll(Array.from(e.dataTransfer.files));
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={cn(
        'flex flex-wrap items-center gap-3 rounded-xl border border-dashed px-4 py-3 transition-colors',
        dragging ? 'border-primary bg-primary/5' : 'border-border/80',
      )}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        accept="image/jpeg,image/png,image/webp,application/pdf"
        onChange={(e) => void scanAll(Array.from(e.target.files ?? []))}
      />
      <Button type="button" disabled={busy} onClick={() => inputRef.current?.click()}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Camera className="size-4" />}
        {busy
          ? progress.total > 1
            ? `Reading receipt… (${progress.done + 1} of ${progress.total})`
            : 'Reading receipt…'
          : 'Scan a receipt'}
      </Button>
      <span className="text-sm text-muted-foreground">or drop receipt photos and PDFs here</span>
    </div>
  );
}
