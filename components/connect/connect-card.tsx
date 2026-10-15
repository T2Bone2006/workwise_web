import type { ReactNode } from 'react';
import { CircleAlert, CircleCheck, Clock } from 'lucide-react';
import { IconChip, type Tone } from '@/components/look';
import { PayPageFrame } from '@/components/pay/pay-shell';

const LOOKS: Record<'success' | 'checking' | 'problem', { tone: Tone; icon: typeof CircleCheck }> = {
  success: { tone: 'emerald', icon: CircleCheck },
  checking: { tone: 'sky', icon: Clock },
  problem: { tone: 'amber', icon: CircleAlert },
};

/**
 * Where Stripe, GoCardless and the texts checkout send you back to: one card with what happened.
 * `status` picks the colour and icon: done (green), still checking (blue), needs you (amber).
 */
export function ConnectCard(props: {
  title: string;
  children: ReactNode;
  status?: 'success' | 'checking' | 'problem';
}) {
  const look = LOOKS[props.status ?? inferStatus(props.title)];
  return (
    <PayPageFrame>
      <div className="space-y-4 rounded-3xl border border-border bg-card p-6 text-center shadow-(--look-card-shadow) sm:p-8">
        <span className="mx-auto flex w-fit">
          <IconChip icon={look.icon} tone={look.tone} />
        </span>
        <p className="text-xl font-semibold tracking-tight text-balance">{props.title}</p>
        <div className="space-y-3 text-sm text-muted-foreground">{props.children}</div>
      </div>
      <p className="mt-5 text-center text-xs text-muted-foreground opacity-80">Powered by WorkWise</p>
    </PayPageFrame>
  );
}

/** Titles already say it: "You're all set" is done; anything about trouble needs you. */
function inferStatus(title: string): 'success' | 'checking' | 'problem' {
  if (/all set|saved|thanks|done|connected/i.test(title)) return 'success';
  if (/didn|couldn|problem|wrong|expired|not /i.test(title)) return 'problem';
  return 'checking';
}
