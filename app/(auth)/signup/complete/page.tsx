import type { Metadata } from 'next';
import { AuthShell } from '@/components/auth/auth-shell';
import { SignupComplete } from '@/components/auth/signup-complete';

export const metadata: Metadata = {
  title: 'Setting up your account | WorkWise',
};

export default async function SignupCompletePage({
  searchParams,
}: {
  searchParams: Promise<{ canceled?: string }>;
}) {
  const params = await searchParams;

  return (
    <AuthShell
      title={params.canceled ? 'Payment not completed' : 'Setting up your account…'}
      subtitle={
        params.canceled
          ? 'You can resume payment whenever you are ready.'
          : 'This usually takes a few seconds.'
      }
    >
      <SignupComplete canceled={Boolean(params.canceled)} />
    </AuthShell>
  );
}
