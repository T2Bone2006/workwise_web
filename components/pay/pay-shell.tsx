import type { JSX, ReactNode } from 'react';
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from '@/components/ui/card';
import type { PublicBusiness } from '@/lib/data/payments/public-pay';

export function PayPageFrame(props: { children: ReactNode }): JSX.Element {
  return (
    <div className="animated-gradient-bg relative flex min-h-screen flex-col items-center px-4 py-10">
      <div className="relative z-0 w-full max-w-[480px]">{props.children}</div>
    </div>
  );
}

/** A short notice at the top of a pay page (a return from GoCardless, a refused start). */
export function PayBanner(props: {
  tone: 'good' | 'info' | 'warn';
  children: ReactNode;
}): JSX.Element {
  return (
    <p
      className={
        props.tone === 'good'
          ? 'rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300'
          : props.tone === 'warn'
            ? 'rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-100'
            : 'rounded-lg border border-border/80 bg-card/60 px-3 py-2 text-sm text-muted-foreground'
      }
    >
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
      <Card className="glass-card border-white/10 backdrop-blur-xl transition-all duration-300 dark:border-white/[0.06] dark:backdrop-blur-2xl">
        <CardHeader className="items-center">
          {business.logoUrl ? (
            <div className="flex items-center justify-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={business.logoUrl}
                alt=""
                className="max-h-12 max-w-[120px] shrink-0 rounded-lg object-contain"
              />
              <p className="text-lg font-semibold tracking-tight">{business.name}</p>
            </div>
          ) : (
            <p className="text-center text-xl font-semibold tracking-tight">{business.name}</p>
          )}
        </CardHeader>
        <CardContent className="space-y-6">
          {children}
          {phone || email ? (
            <div className="rounded-xl border border-border/80 bg-card/60 p-4 text-sm">
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
        </CardContent>
        <CardFooter className="flex-col gap-1 border-t text-center text-sm text-muted-foreground">
          <p>Payments go directly to {business.name}.</p>
          <p className="text-xs text-muted-foreground/80">Powered by WorkWise</p>
        </CardFooter>
      </Card>
    </PayPageFrame>
  );
}
