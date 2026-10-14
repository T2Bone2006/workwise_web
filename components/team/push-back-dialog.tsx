'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { floatingMessage } from '@/components/look';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { tellCustomersAboutChange, undoVisitChange } from '@/lib/actions/rounds/visits';
import { previewPushBackAction, pushBackAction } from '@/lib/actions/team-days-off';
import { formatOffRange, type OffWarning } from '@/lib/team/off-warning';
import { DIALOG_SHEET } from './team-ui';

export type PushBackPreview =
  | { state: 'loading' }
  | { state: 'error'; error: string }
  | { state: 'ready'; moves: number; stuck: number; lastDate: string | null; firstMoves: Array<{ customerName: string; from: string; to: string }> };

/**
 * Slide a person's visits along to their next working days, in the same order. The preview comes first and nothing moves
 * until Push back. Nobody is texted unless "tell customers" is ticked here or Tell them is pressed afterwards.
 */
export function PushBackDialog({ warning, onClose }: { warning: OffWarning; onClose: () => void }) {
  const router = useRouter();
  const [preview, setPreview] = useState<PushBackPreview>({ state: 'loading' });
  const [notify, setNotify] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await previewPushBackAction({ workerId: warning.workerId, offFrom: warning.from, offTo: warning.to });
      if (cancelled) return;
      setPreview(
        result.success
          ? { state: 'ready', moves: result.moves, stuck: result.stuck, lastDate: result.lastDate, firstMoves: result.firstMoves }
          : { state: 'error', error: result.error },
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [warning.workerId, warning.from, warning.to]);

  const push = async () => {
    if (pending || preview.state !== 'ready' || preview.moves === 0) return;
    setPending(true);
    setError(null);
    const result = await pushBackAction({ workerId: warning.workerId, offFrom: warning.from, offTo: warning.to, notifyCustomers: notify });
    setPending(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    const changeId = result.changeId;
    const last = preview.lastDate ? formatOffRange(preview.lastDate, preview.lastDate) : null;
    floatingMessage({
      title: `Pushed back ${result.moved} ${result.moved === 1 ? 'visit' : 'visits'}${last ? ` to ${last}` : ''}`,
      body: notify ? 'Customers have been told' : 'Customers not told yet',
      tone: 'success',
      actions: changeId
        ? [
            {
              label: 'Undo',
              onClick: async () => {
                await undoVisitChange({ changeId, notifyCustomers: false });
                router.refresh();
              },
            },
            ...(notify
              ? []
              : [
                  {
                    label: 'Tell them',
                    onClick: async () => {
                      const told = await tellCustomersAboutChange({ changeId });
                      floatingMessage(told.success ? { title: 'Customers told', tone: 'success' } : { title: told.error, tone: 'error' });
                      router.refresh();
                    },
                  },
                ]),
          ]
        : undefined,
    });
    onClose();
    router.refresh();
  };

  return (
    <PushBackView
      warning={warning}
      preview={preview}
      notify={notify}
      onNotify={setNotify}
      pending={pending}
      error={error}
      onClose={onClose}
      onPush={push}
    />
  );
}

/** What the Push back dialog looks like for a given preview. No data loading: the container above does that. */
export function PushBackView({
  warning,
  preview,
  notify,
  onNotify,
  pending,
  error,
  onClose,
  onPush,
}: {
  warning: OffWarning;
  preview: PushBackPreview;
  notify: boolean;
  onNotify: (value: boolean) => void;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onPush: () => void;
}) {
  const owner = warning.isOwner;
  const possessive = owner ? 'your' : `${warning.name}'s`;
  const their = owner ? 'your' : 'their';
  return (
    <Dialog open onOpenChange={(open) => (!open && !pending ? onClose() : undefined)}>
      <DialogContent className={DIALOG_SHEET}>
        <DialogHeader>
          <DialogTitle>Push {possessive} round back</DialogTitle>
          <DialogDescription>
            {owner ? 'Your' : `${warning.name}'s`} visits slide along to {their} next working days, in the same order. Each customer&apos;s next visit stays where it is.
          </DialogDescription>
        </DialogHeader>

        {preview.state === 'loading' ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <Loader2 className="size-4 animate-spin" /> Working out what would move…
          </p>
        ) : preview.state === 'error' ? (
          <p role="alert" className="text-sm text-destructive">
            {preview.error}
          </p>
        ) : preview.moves === 0 ? (
          <p className="rounded-xl bg-muted/60 px-3 py-3 text-sm">
            Nothing to move. {owner ? 'You have' : `${warning.name} has`} no stops on those days.
          </p>
        ) : (
          <div className="grid gap-3">
            <p className="text-sm">
              <span className="font-semibold">
                {preview.moves} {preview.moves === 1 ? 'visit' : 'visits'}
              </span>{' '}
              will move{preview.lastDate ? <>, the last to <span className="font-semibold">{formatOffRange(preview.lastDate, preview.lastDate)}</span></> : null}.
            </p>
            <ul className="divide-y divide-border rounded-xl border border-border text-sm" aria-label="First visits to move">
              {preview.firstMoves.map((m, i) => (
                <li key={`${m.customerName}-${m.from}-${i}`} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="min-w-0 truncate font-medium">{m.customerName}</span>
                  <span className="shrink-0 text-muted-foreground tabular-nums">
                    {formatOffRange(m.from, m.from)} → {formatOffRange(m.to, m.to)}
                  </span>
                </li>
              ))}
              {preview.moves > preview.firstMoves.length ? (
                <li className="px-3 py-2 text-xs text-muted-foreground">and {preview.moves - preview.firstMoves.length} more</li>
              ) : null}
            </ul>
            {preview.stuck > 0 ? (
              <p className="rounded-xl bg-(--tone-amber-soft) px-3 py-2.5 text-sm text-(--tone-amber-text)">
                {preview.stuck} {preview.stuck === 1 ? "visit can't" : "visits can't"} move (their next visit is too soon). {preview.stuck === 1 ? 'It stays' : 'They stay'} where {preview.stuck === 1 ? 'it is' : 'they are'}.
              </p>
            ) : null}
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={notify} onCheckedChange={(v) => onNotify(v === true)} disabled={pending} />
              Tell customers their new date
            </label>
          </div>
        )}

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter className="gap-2 sm:gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
            {preview.state === 'ready' && preview.moves === 0 ? 'Close' : 'Cancel'}
          </Button>
          {preview.state === 'ready' && preview.moves > 0 ? (
            <Button type="button" onClick={onPush} disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : null}
              {notify ? 'Push back and tell customers' : 'Push back'}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
