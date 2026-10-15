import { WorkerNotConnected } from '@/components/worker/worker-not-connected';
import { getWorkerLink } from '@/lib/auth/worker-link';

/** Every worker page needs a live link to an employer; without one the person sees why, never an empty shell. */
export default async function WorkerLayout({ children }: { children: React.ReactNode }) {
  const link = await getWorkerLink();
  if (!link) return <WorkerNotConnected />;
  return <>{children}</>;
}
