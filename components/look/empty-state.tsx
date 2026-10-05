import type { LucideIcon } from 'lucide-react';

/** An empty screen is an invitation: say what goes here and offer the next step. */
export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon: LucideIcon;
  title: string;
  body?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border bg-card px-6 py-10 text-center">
      <span className="flex size-11 items-center justify-center rounded-2xl bg-muted text-muted-foreground" aria-hidden="true">
        <Icon className="size-5" />
      </span>
      <p className="text-[15px] font-semibold">{title}</p>
      {body ? <p className="max-w-sm text-sm text-muted-foreground">{body}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
