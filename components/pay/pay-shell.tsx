import type { JSX, ReactNode } from 'react';
import { BusinessMark, PublicFrame, toneClasses, type Tone } from '@/components/look';
import { cn } from '@/lib/utils';
import type { PublicBusiness } from '@/lib/data/payments/public-pay';

export function PayPageFrame(props: { children: ReactNode }): JSX.Element {
  return <PublicFrame>{props.children}</PublicFrame>;
}

const BANNER_TONE: Record<'good' | 'info' | 'warn', Tone> = { good: 'emerald', info: 'slate', warn: 'amber' };

/** A short notice at the top of a pay page (a return from GoCardless, a refused start). */
export function PayBanner(props: {
  tone: 'good' | 'info' | 'warn';
  children: ReactNode;
}): JSX.Element {
  const tone = toneClasses(BANNER_TONE[props.tone]);
  return (
    <p className={cn('rounded-xl border px-3.5 py-2.5 text-sm', tone.soft, tone.border, tone.text)} role="status">
      {props.children}
    </p>
  );
}

export function PayShell(props: {
  business: PublicBusiness;
  children: ReactNode;
}): JSX.Element {
  const { business, children } = props;
  const phone = business.phone?.trim() || null;
  const email = business.email?.trim() || null;

  return (
    <PayPageFrame>
      <header className="mb-4 flex items-center gap-3 px-1">
        <BusinessMark name={business.name} logoUrl={business.logoUrl} size="lg" />
        <p className="min-w-0 text-lg font-semibold tracking-tight">{business.name}</p>
      </header>
      <main className="space-y-5 rounded-3xl border border-border bg-card p-5 shadow-(--look-card-shadow) sm:p-6">
        {children}
        {phone || email ? (
          <div className="rounded-2xl bg-muted/60 p-4 text-sm">
            <p className="font-medium">Questions, or already paid?</p>
            <p className="mt-1 text-muted-foreground">
              Contact {business.name} directly
              {phone ? (
                <>
                  {' on '}
                  <a
                    className="font-medium text-primary underline-offset-4 hover:underline"
                    href={`tel:${phone.replace(/\s+/g, '')}`}
                  >
                    {phone}
                  </a>
                </>
              ) : null}
              {phone && email ? ' or ' : null}
              {email ? (
                <>
                  {phone ? null : ' at '}
                  <a
                    className="font-medium text-primary underline-offset-4 hover:underline"
                    href={`mailto:${email}`}
                  >
                    {email}
                  </a>
                </>
              ) : null}
              .
            </p>
          </div>
        ) : null}
      </main>
      <footer className="mt-5 space-y-1 text-center text-sm text-muted-foreground">
        <p>Payments go directly to {business.name}.</p>
        <p className="text-xs opacity-80">Powered by WorkWise</p>
      </footer>
    </PayPageFrame>
  );
}
