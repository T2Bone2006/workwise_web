import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { ConnectCard } from '@/components/connect/connect-card';
import { refreshConnectStatus } from '@/lib/actions/stripe-connect';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Card payments',
  robots: { index: false, follow: false },
};

type PageProps = {
  searchParams: Promise<{ from?: string }>;
};

export default async function ConnectReturnPage({ searchParams }: PageProps) {
  const { from } = await searchParams;

  if (from === 'app') {
    return (
      <ConnectCard title="You're all set">
        <p>Go back to the WorkWise app. If Stripe still needs anything, the app will tell you.</p>
      </ConnectCard>
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    await refreshConnectStatus();
    redirect('/payments?connect=done');
  }

  return (
    <ConnectCard title="Card payments">
      <p>Setup saved. Sign in to WorkWise to see your card payments.</p>
    </ConnectCard>
  );
}
