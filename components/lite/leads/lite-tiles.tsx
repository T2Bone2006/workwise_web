import { CalendarCheck, Inbox, MessagesSquare, Sparkles } from 'lucide-react';
import { StatTile } from '@/components/look';
import { formatPounds } from '@/components/lite/leads/lead-card';
import type { LeadsBoardData } from '@/lib/data/lite/leads-board';

/** The four numbers. Waiting turns amber, and only when someone is actually waiting. */
export function LiteTiles({ tiles }: { tiles: LeadsBoardData['tiles'] }) {
  const waiting = tiles.waiting > 0;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <StatTile
        label="Waiting for you"
        value={String(tiles.waiting)}
        sub="booking requests"
        tone={waiting ? 'amber' : 'slate'}
        icon={Inbox}
      />
      <StatTile label="New this week" value={String(tiles.newThisWeek)} sub="enquiries" tone="lite" icon={Sparkles} />
      <StatTile
        label="Won this month"
        value={String(tiles.wonThisMonth.count)}
        sub={`${formatPounds(tiles.wonThisMonth.amount)} agreed`}
        tone="emerald"
        icon={CalendarCheck}
      />
      <StatTile
        label="Chats this week"
        value={String(tiles.chatsThisWeek.total)}
        sub={`${tiles.chatsThisWeek.leftDetails} left their details`}
        tone="rounds"
        icon={MessagesSquare}
      />
    </div>
  );
}
