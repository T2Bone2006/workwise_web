import type { Metadata } from 'next';
import { ConnectCard } from '@/components/connect/connect-card';
import { ContinueSetupButton } from '@/components/connect/continue-setup-button';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Continue card payments setup',
  robots: { index: false, follow: false },
};

type PageProps = {
  searchParams: Promise<{ from?: string }>;
};

export default async function ConnectRefreshPage({ searchParams }: PageProps) {
  const { from } = await searchParams;

  if (from === 'app') {
    return (
      <ConnectCard title="Setup link expired">
        <p>This setup link has expired. Go back to the WorkWise app and tap Finish setting up.</p>
      </ConnectCard>
    );
  }

  return (
    <ConnectCard title="Continue setup">
      <p>This setup link has expired. Continue to get a new one.</p>
      <ContinueSetupButton />
    </ConnectCard>
  );
}
