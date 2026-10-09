import { createClient } from '@/lib/supabase/server';
import { WORKER_HOME } from '@/lib/auth/worker-web-access';
import { redirect } from 'next/navigation';

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const { data: profile } = await supabase
      .from('users')
      .select('role')
      .eq('id', user.id)
      .maybeSingle<{ role: string | null }>();

    if (profile?.role === 'worker') {
      redirect(WORKER_HOME);
    }

    if (profile?.role === 'customer_portal') {
      redirect('/portal');
    }

    redirect('/dashboard');
  }

  redirect('/login');
}
