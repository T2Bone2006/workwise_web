import type { Metadata } from 'next';
import { AccountantNav } from '@/components/accountant/accountant-nav';
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
    return <div className="min-h-screen bg-background px-4">{children}</div>;
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b print:border-0">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <div>
            <h1 className="text-lg font-semibold">{state.ctx.businessName}&apos;s books</h1>
            <p className="text-xs text-muted-foreground">Read-only access for {state.ctx.email}</p>
          </div>
          <form method="post" action={`/accountant/${encodeURIComponent(token)}/sign-out`} className="print:hidden">
            <button type="submit" className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted">
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-5xl space-y-5 px-4 py-6">
        <div className="print:hidden"><AccountantNav token={token} /></div>
        {children}
      </main>
    </div>
  );
}
