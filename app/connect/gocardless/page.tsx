import type { Metadata } from 'next';
import { ConnectCard } from '@/components/connect/connect-card';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'GoCardless',
  robots: { index: false, follow: false },
};

type PageProps = {
  searchParams: Promise<{ result?: string }>;
};

type Status = 'success' | 'checking' | 'problem';

const RESULTS: Record<string, { title: string; text: string; status: Status }> = {
  connected: {
    title: 'GoCardless connected',
    text: 'Go back to the WorkWise app. If GoCardless needs more details from you, the app will show a button.',
    status: 'success',
  },
  cancelled: {
    title: 'Not connected',
    text: "You didn't connect GoCardless. You can try again from the WorkWise app any time.",
    status: 'problem',
  },
  expired: {
    title: 'That link has expired',
    text: 'Go back to the WorkWise app and press Connect GoCardless again.',
    status: 'problem',
  },
  taken: {
    title: 'Already connected elsewhere',
    text: 'That GoCardless account is already connected to another WorkWise business.',
    status: 'problem',
  },
};

const FALLBACK: { title: string; text: string; status: Status } = {
  status: 'problem',
  title: 'Something went wrong',
  text: 'Go back to the WorkWise app and try again.',
};

/** Where the phone's GoCardless connect lands (from = 'app'). */
export default async function GoCardlessConnectResultPage({ searchParams }: PageProps) {
  const { result } = await searchParams;
  const copy = result && Object.hasOwn(RESULTS, result) ? RESULTS[result] : FALLBACK;
  return (
    <ConnectCard title={copy.title} status={copy.status}>
      <p>{copy.text}</p>
    </ConnectCard>
  );
}
