import { MessageSquare } from 'lucide-react';
import { TextsMeter } from '@/components/messaging/texts-meter';
import type { TextUsage } from '@/lib/data/messaging/texts';

/** The right-hand side when no conversation is open (laptop only; on a phone you see the list). */
export function MessagesEmptyPane({ usage }: { usage: TextUsage | null }) {
  return (
    <div className="space-y-5">
      <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border bg-card px-6 py-12 text-center">
        <span className="flex size-12 items-center justify-center rounded-2xl bg-(--tone-rounds-soft) text-(--tone-rounds-text)" aria-hidden="true">
          <MessageSquare className="size-5" />
        </span>
        <p className="text-[15px] font-semibold">Pick a conversation</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          Replies that need your choice are at the top. Open one to skip, keep or move the visit.
        </p>
      </div>
      {usage ? <TextsMeter usage={usage} /> : null}
    </div>
  );
}
