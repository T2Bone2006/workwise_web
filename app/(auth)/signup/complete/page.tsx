import type { Metadata } from 'next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
    <Card className="glass-card backdrop-blur-xl border-white/10 dark:backdrop-blur-2xl dark:border-white/[0.06]">
      <CardHeader className="space-y-1 text-center">
        <CardTitle className="text-2xl font-semibold tracking-tight">
          {params.canceled ? 'Payment not completed' : 'Setting up your account'}
        </CardTitle>
        <CardDescription>
          {params.canceled
            ? 'You can resume payment whenever you are ready.'
            : 'This usually takes a few seconds.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <SignupComplete canceled={Boolean(params.canceled)} />
      </CardContent>
    </Card>
  );
}
