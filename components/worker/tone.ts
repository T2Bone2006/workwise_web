import type { Tone } from '@/components/look';
import type { WorkerTone } from '@/lib/worker/status';

/** The worker status colours, expressed in the dashboard's tone names (one colour, one meaning). */
const MAP: Record<WorkerTone, Tone> = {
  blue: 'rounds',
  green: 'emerald',
  amber: 'amber',
  rose: 'rose',
  slate: 'slate',
  sky: 'sky',
  indigo: 'indigo',
};

export function toLookTone(tone: WorkerTone): Tone {
  return MAP[tone];
}
