import Link from 'next/link';
import { cn } from '@/lib/utils';

/** One of the four numbers, as on the Rounds overview: small label, big vivid figure, a grey line under. */
export function Kpi({
  href,
  label,
  value,
  figure,
  sub,
}: {
  href: string;
  label: string;
  value: string;
  figure: string;
  sub: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="group block rounded-2xl border border-border bg-card px-4 py-4 transition-colors hover:border-(--tone-slate-solid)/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none sm:px-5"
    >
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={cn('mt-1 text-[26px] leading-none font-semibold tracking-tight tabular-nums', figure)}>{value}</p>
      <div className="mt-2 text-xs leading-relaxed text-muted-foreground">{sub}</div>
    </Link>
  );
}

