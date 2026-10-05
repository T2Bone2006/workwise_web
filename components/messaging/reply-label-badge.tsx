import type { JSX } from 'react';
import { formatVisitDay } from '@/lib/payments/messages';
import { isValidYmd } from '@/lib/rounds/dates';
import type { ReplyLabel } from '@/lib/data/messaging/threads';
import { Tag } from '@/components/look';

function dayLabel(ymd: string | null): string | null {
  if (!ymd || !isValidYmd(ymd)) return null;
  return formatVisitDay(ymd);
}

export function ReplyLabelBadge(props: { label: ReplyLabel | null }): JSX.Element | null {
  const { label } = props;
  if (!label) return null;

  if (label.kind === 'said_no') return <Tag tone="rose">Said no</Tag>;

  if (label.kind === 'asked_move') {
    const day = dayLabel(label.requestedDate);
    return <Tag tone="amber">{day ? `Asked for ${day}` : 'Asked to move'}</Tag>;
  }

  return <Tag tone="rounds">Sent a message</Tag>;
}
