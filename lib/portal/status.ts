import type { Tone } from '@/components/look/tones';

/**
 * How a job's status reads to the customer: plain words, one colour per meaning.
 * The office has its own labels; this is only for the portal.
 */
export function customerStatus(status: string | null | undefined): { label: string; tone: Tone } {
  switch (status) {
    case 'completed':
      return { label: 'Completed', tone: 'emerald' };
    case 'incomplete':
      return { label: 'Not completed', tone: 'rose' };
    case 'in_progress':
      return { label: 'In progress', tone: 'sky' };
    case 'paused':
      return { label: 'Paused', tone: 'amber' };
    case 'assigned':
      return { label: 'Booked', tone: 'indigo' };
    case 'accepted':
      return { label: 'Confirmed', tone: 'indigo' };
    case 'declined':
      return { label: 'Being reassigned', tone: 'slate' };
    case 'cancelled':
      return { label: 'Cancelled', tone: 'slate' };
    case 'pending':
    case 'pending_send':
    default:
      return { label: 'Awaiting booking', tone: 'slate' };
  }
}
