import type { Metadata } from 'next';
import { ConnectCard } from '@/components/connect/connect-card';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Texts',
  robots: { index: false, follow: false },
};

type PageProps = {
  searchParams: Promise<{ status?: string }>;
};

export default async function ConnectTextsPage({ searchParams }: PageProps) {
  const { status } = await searchParams;
  const cancelled = status === 'cancelled';

  return (
    <ConnectCard title="Texts" status={cancelled ? 'checking' : 'success'}>
      <p>
        {cancelled
          ? 'No charge made.'
          : 'Thanks, your texts are being added. You can go back to the WorkWise app now.'}
      </p>
    </ConnectCard>
  );
}
