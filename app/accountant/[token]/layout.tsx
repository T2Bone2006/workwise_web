import type { Metadata } from 'next';
import { AccountantNav } from '@/components/accountant/accountant-nav';
import { BusinessMark, PublicFrame } from '@/components/look';
import { LookAttribute } from '@/components/look/look-attribute';
import { requireAccountant } from '@/lib/accountant/context';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Books',
  robots: { index: false, follow: false },
};

/**
 * A plain shell, outside the dashboard layout. It only decides how the page
 * looks: every page and route handler checks access itself.
 */
export default async function AccountantLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const state = await requireAccountant(token);

  if (state.status !== 'ok') {
    return <PublicFrame width="max-w-md">{children}</PublicFrame>;
  }

  return (
    <div data-look="new" className="min-h-screen bg-background text-foreground">
      <LookAttribute look="new" />
      <header className="border-b border-border bg-card print:border-0 print:bg-transparent">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <div className="flex items-center gap-3">
            <span className="print:hidden">
              <BusinessMark name={state.ctx.businessName} logoUrl={null} />
            </span>
            <div>
              <h1 className="text-lg font-semibold tracking-tight">{state.ctx.businessName}&apos;s books</h1>
              <p className="text-xs text-muted-foreground">Read-only access for {state.ctx.email}</p>
            </div>
          </div>
          <form method="post" action={`/accountant/${encodeURIComponent(token)}/sign-out`} className="print:hidden">
            <button
              type="submit"
              className="rounded-full border border-border bg-card px-4 py-1.5 text-sm font-medium transition-colors hover:bg-muted"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-5xl space-y-5 px-4 py-6">
        <div className="print:hidden">
          <AccountantNav token={token} />
        </div>
        {children}
      </main>
      <footer className="mx-auto max-w-5xl px-4 pb-8 text-xs text-muted-foreground opacity-80 print:hidden">
        Powered by WorkWise
      </footer>
    </div>
  );
}
