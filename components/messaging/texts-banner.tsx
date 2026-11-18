'use client';

import { useState, type JSX } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, MessageSquareWarning, Send } from 'lucide-react';
import { toast } from 'sonner';
import { Notice } from '@/components/look';
import { Button } from '@/components/ui/button';
import { dismissAutoTopUpPromptAction } from '@/lib/actions/auto-top-up';
import { sendWaitingMessages } from '@/lib/actions/send-waiting';
import { startTextPackCheckout } from '@/lib/actions/text-packs';
import { TEXT_PACKS } from '@/lib/messaging/credits';
import type { TextsStatus } from '@/lib/data/messaging/texts-status';

const SMALL_PACK = TEXT_PACKS[0].key;

/** Not dismissible: it clears itself when the problem does. Shown above every dashboard page for Rounds. */
export function TextsBanner({ status }: { status: TextsStatus }): JSX.Element | null {
  const router = useRouter();
  const [busy, setBusy] = useState<'buy' | 'send' | 'dismiss' | null>(null);
  const [hidePrompt, setHidePrompt] = useState(false);

  if (status.banner === 'none') return null;

  const { waiting, totalLeft } = status;
  const promptVisible = status.autoTopUp.promptVisible && !hidePrompt;

  async function buy() {
    setBusy('buy');
    const result = await startTextPackCheckout(SMALL_PACK);
    if ('url' in result && result.url) {
      window.location.assign(result.url);
      return;
    }
    setBusy(null);
    toast.error('error' in result ? result.error : 'Could not start checkout');
  }

  async function sendWaiting() {
    if (busy) return;
    setBusy('send');
    const result = await sendWaitingMessages();
    setBusy(null);
    if ('error' in result) {
      if (result.error === 'Nothing is waiting') router.refresh();
      else toast.error(result.error);
      return;
    }
    const parts = [
      result.sent > 0 ? `Sent ${result.sent}` : null,
      result.stillWaiting > 0 ? `${result.stillWaiting} still waiting` : null,
      result.expired > 0 ? `${result.expired} waited too long (see "Didn't get their message")` : null,
    ].filter(Boolean);
    toast.success(parts.length > 0 ? parts.join(', ') : 'Nothing was waiting');
    router.refresh();
  }

  async function notNow() {
    setBusy('dismiss');
    setHidePrompt(true);
    await dismissAutoTopUpPromptAction();
    setBusy(null);
  }

  const autoTopUpAction = promptVisible ? (
    <div className="flex items-center gap-2">
      <Button asChild size="sm" variant="outline">
        <Link href="/messages#auto-top-up">Turn on auto top-up</Link>
      </Button>
      <Button type="button" size="sm" variant="ghost" disabled={busy != null} onClick={() => void notNow()}>
        Not now
      </Button>
    </div>
  ) : null;

  if (status.banner === 'paused') {
    const reason =
      status.autoTopUp.pausedReason === 'needs_authentication'
        ? 'Your bank wanted you to confirm the payment.'
        : status.autoTopUp.pausedReason === 'no_card'
          ? "There's no card on file."
          : "We couldn't charge your card.";
    return (
      <div className="px-4 pt-4 sm:px-8">
        <Notice
          tone="rose"
          icon={AlertTriangle}
          title="Auto top-up is paused"
          action={
            <div className="flex flex-wrap items-center gap-2">
              <Button asChild size="sm">
                <Link href="/messages#auto-top-up">Fix it</Link>
              </Button>
              <Button type="button" size="sm" variant="outline" disabled={busy != null} onClick={() => void buy()}>
                Buy texts
              </Button>
            </div>
          }
        >
          {reason}
        </Notice>
      </div>
    );
  }

  if (status.banner === 'waiting') {
    return (
      <div className="px-4 pt-4 sm:px-8">
        <Notice
          tone="amber"
          icon={Send}
          title={`${waiting.count} ${waiting.count === 1 ? 'message is' : 'messages are'} waiting to go`}
          action={
            <Button type="button" size="sm" disabled={busy != null} onClick={() => void sendWaiting()}>
              {busy === 'send' ? 'Sending…' : 'Send waiting messages'}
            </Button>
          }
        >
          They need {waiting.textsNeeded} {waiting.textsNeeded === 1 ? 'text' : 'texts'}. You have {totalLeft}.
        </Notice>
      </div>
    );
  }

  const out = status.banner === 'out';
  return (
    <div className="px-4 pt-4 sm:px-8">
      <Notice
        tone={out ? 'rose' : 'amber'}
        icon={MessageSquareWarning}
        title={out ? "You're out of texts" : `${totalLeft} ${totalLeft === 1 ? 'text' : 'texts'} left`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" disabled={busy != null} onClick={() => void buy()}>
              {busy === 'buy' ? 'Opening…' : 'Buy texts'}
            </Button>
            {autoTopUpAction}
          </div>
        }
      >
        {out
          ? `${waiting.count > 0 ? `${waiting.count} ${waiting.count === 1 ? 'message is' : 'messages are'} waiting. ` : ''}Customers with an email still get emails.`
          : "When they run out, customers with only a phone number won't get their pay link."}
      </Notice>
    </div>
  );
}
