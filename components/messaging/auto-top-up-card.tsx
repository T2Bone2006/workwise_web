'use client';

import { useEffect, useState, type JSX } from 'react';
import { useRouter } from 'next/navigation';
import { Repeat } from 'lucide-react';
import { toast } from 'sonner';
import { LookCard, Tag } from '@/components/look';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  dismissAutoTopUpPromptAction,
  readAutoTopUpCard,
  resumeAutoTopUpAction,
  saveAutoTopUp,
  turnOffAutoTopUp,
} from '@/lib/actions/auto-top-up';
import { TEXT_PACKS } from '@/lib/messaging/credits';
import type { TextsStatus } from '@/lib/data/messaging/texts-status';
import { cn } from '@/lib/utils';

function poundsLabel(pence: number): string {
  return pence % 100 === 0 ? `£${pence / 100}` : `£${(pence / 100).toFixed(2)}`;
}

type Card = { brand: string; last4: string } | null;

/** The Auto top-up section of the Texts page. Off by default; the banner asks once or twice. */
export function AutoTopUpCard({ status }: { status: TextsStatus }): JSX.Element {
  const router = useRouter();
  const top = status.autoTopUp;
  const [editing, setEditing] = useState(false);
  const [packKey, setPackKey] = useState<string>(top.packKey);
  const [triggerLeft, setTriggerLeft] = useState(String(top.triggerLeft));
  const [limitPounds, setLimitPounds] = useState(String(Math.round(top.monthlyCapPence / 100)));
  const [busy, setBusy] = useState(false);
  const [card, setCard] = useState<Card>(null);

  useEffect(() => {
    let live = true;
    readAutoTopUpCard()
      .then((c) => {
        if (live) setCard(c);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [top.enabled, top.pausedReason]);

  const pack = TEXT_PACKS.find((p) => p.key === packKey) ?? TEXT_PACKS[0];
  const showForm = !top.enabled || editing;

  async function save() {
    setBusy(true);
    const result = await saveAutoTopUp({
      packKey,
      triggerLeft: Number(triggerLeft),
      monthlyCapPounds: Number(limitPounds),
    });
    setBusy(false);
    if ('error' in result) {
      toast.error(result.error);
      return;
    }
    if ('needsCard' in result) {
      window.location.assign(result.url);
      return;
    }
    setEditing(false);
    toast.success('Auto top-up is on');
    router.refresh();
  }

  async function off() {
    setBusy(true);
    const result = await turnOffAutoTopUp();
    setBusy(false);
    if ('error' in result) toast.error(result.error);
    else router.refresh();
  }

  async function resume() {
    setBusy(true);
    const result = await resumeAutoTopUpAction();
    setBusy(false);
    if ('error' in result) toast.error(result.error);
    else {
      toast.success('Auto top-up is back on');
      router.refresh();
    }
  }

  async function notNow() {
    await dismissAutoTopUpPromptAction();
    router.refresh();
  }

  const paused = top.enabled && top.pausedReason != null;
  const reason =
    top.pausedReason === 'needs_authentication'
      ? 'Your bank wanted you to confirm the payment.'
      : top.pausedReason === 'no_card'
        ? "There's no card on file."
        : "We couldn't charge your card.";

  return (
    <div id="auto-top-up" className="scroll-mt-24">
      <LookCard
        title="Auto top-up"
        icon={Repeat}
        tone={paused ? 'rose' : top.enabled ? 'emerald' : 'rounds'}
        aside={paused ? <Tag tone="rose">Paused</Tag> : top.enabled ? <Tag tone="emerald">On</Tag> : <Tag tone="slate">Off</Tag>}
      >
        {paused ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{reason} Nothing has been bought. Fix your card, then resume.</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" disabled={busy} onClick={() => void resume()}>
                Resume
              </Button>
              <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setEditing(true)}>
                Change
              </Button>
            </div>
          </div>
        ) : null}

        {!showForm && !paused ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              When you drop to <strong className="text-foreground">{top.triggerLeft}</strong> texts, we buy{' '}
              <strong className="text-foreground">
                {pack.label} ({poundsLabel(pack.pricePence)})
              </strong>
              {card ? ` from your card ending ${card.last4}` : ''}. At most one a day, never more than{' '}
              {poundsLabel(top.monthlyCapPence)} a month. We email you a receipt each time.
            </p>
            <p className="text-sm tabular-nums">
              This month: {poundsLabel(top.spentThisMonthPence)} of {poundsLabel(top.monthlyCapPence)} spent.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setEditing(true)}>
                Change
              </Button>
              <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void off()}>
                Turn off
              </Button>
            </div>
          </div>
        ) : null}

        {showForm ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Never run out. When you drop to <strong className="text-foreground">{triggerLeft || '…'}</strong> texts, we&apos;ll buy{' '}
              <strong className="text-foreground">
                {pack.label} ({poundsLabel(pack.pricePence)})
              </strong>{' '}
              from your card. At most one a day, never more than{' '}
              <strong className="text-foreground">£{limitPounds || '…'}</strong> a month. We email you a receipt each time. Turn it off any time.
            </p>
            <div className="grid grid-cols-2 gap-3">
              {TEXT_PACKS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => setPackKey(p.key)}
                  className={cn(
                    'rounded-xl border px-3.5 py-3 text-left transition-colors',
                    packKey === p.key ? 'border-primary bg-(--tone-rounds-soft)' : 'border-border bg-muted/40 hover:border-primary/50',
                  )}
                  aria-pressed={packKey === p.key}
                >
                  <span className="block text-sm text-muted-foreground">{p.label}</span>
                  <span className="block text-xl font-semibold tabular-nums">{poundsLabel(p.pricePence)}</span>
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="auto-trigger">When I have this many texts left</Label>
                <Input
                  id="auto-trigger"
                  inputMode="numeric"
                  value={triggerLeft}
                  placeholder="20"
                  onChange={(e) => setTriggerLeft(e.target.value.replace(/\D/g, ''))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="auto-limit">Monthly limit (£)</Label>
                <Input
                  id="auto-limit"
                  inputMode="numeric"
                  value={limitPounds}
                  placeholder="50"
                  onChange={(e) => setLimitPounds(e.target.value.replace(/\D/g, ''))}
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" size="sm" disabled={busy} onClick={() => void save()}>
                {busy ? 'Saving…' : top.enabled ? 'Save changes' : 'Turn on auto top-up'}
              </Button>
              {top.enabled ? (
                <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              ) : top.promptVisible ? (
                <Button type="button" size="sm" variant="ghost" onClick={() => void notNow()}>
                  Not now
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
      </LookCard>
    </div>
  );
}
