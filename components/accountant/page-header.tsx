import { PrintButton } from '@/components/accountant/print-button';

/** Title, the period it covers, and the controls: one pattern for every accountant page. */
export function PageHeader({
  title,
  periodLabel,
  businessName,
  children,
  print = true,
}: {
  title: string;
  periodLabel: string;
  businessName: string;
  children?: React.ReactNode;
  print?: boolean;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
          <p className="text-sm text-muted-foreground">
            <span className="hidden print:inline">{businessName} · </span>
            {periodLabel}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          {children}
          {print ? <PrintButton /> : null}
        </div>
      </div>
    </div>
  );
}
