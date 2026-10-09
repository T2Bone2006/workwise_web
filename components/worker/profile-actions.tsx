'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { KeyRound, LogOut, Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { IconChip, LookCard, floatingMessage } from '@/components/look';
import { Button } from '@/components/ui/button';
import { logout, requestPasswordReset } from '@/lib/actions/auth';

const noopSubscribe = () => () => {};
const COOLDOWN_SECONDS = 30;

function Row({ icon, title, body, children }: { icon: React.ReactNode; title: string; body?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
      {icon}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        {body ? <p className="text-xs text-muted-foreground">{body}</p> : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/** Light / dark, a password reset link to the signed-in email, and Sign out. */
export function ProfileActions({ email }: { email: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const isDark = hydrated && resolvedTheme === 'dark';

  const [cooldown, setCooldown] = useState(0);
  const [sending, setSending] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current);
    },
    [],
  );

  const startCooldown = () => {
    setCooldown(COOLDOWN_SECONDS);
    timer.current = setInterval(() => {
      setCooldown((n) => {
        if (n <= 1) {
          if (timer.current) clearInterval(timer.current);
          return 0;
        }
        return n - 1;
      });
    }, 1000);
  };

  const sendReset = async () => {
    if (sending || cooldown > 0 || !email) return;
    setSending(true);
    try {
      const result = await requestPasswordReset(email);
      if (result.success) {
        floatingMessage({ title: 'Check your email', body: 'We sent a link to choose a new password.' });
        startCooldown();
      } else {
        floatingMessage({ title: "We couldn't send that", body: 'Try again in a minute.', tone: 'error' });
      }
    } catch {
      floatingMessage({ title: "We couldn't send that", body: 'Try again in a minute.', tone: 'error' });
    } finally {
      setSending(false);
    }
  };

  return (
    <LookCard title="App" icon={KeyRound} tone="slate">
      <div className="divide-y divide-border">
        <Row
          icon={<IconChip icon={isDark ? Moon : Sun} tone="indigo" size="sm" />}
          title="Display"
          body={isDark ? 'Dark mode' : 'Light mode'}
        >
          <Button variant="outline" size="sm" onClick={() => setTheme(isDark ? 'light' : 'dark')} disabled={!hydrated}>
            {isDark ? 'Use light' : 'Use dark'}
          </Button>
        </Row>
        <Row
          icon={<IconChip icon={KeyRound} tone="slate" size="sm" />}
          title="Password"
          body="We email a link to choose a new one."
        >
          <Button variant="outline" size="sm" onClick={() => void sendReset()} disabled={sending || cooldown > 0 || !email}>
            {cooldown > 0 ? `Sent (${cooldown})` : 'Email me a reset link'}
          </Button>
        </Row>
        <Row icon={<IconChip icon={LogOut} tone="rose" size="sm" />} title="Sign out" body="You can sign back in any time.">
          <Button variant="outline" size="sm" onClick={() => void logout()}>
            Sign out
          </Button>
        </Row>
      </div>
    </LookCard>
  );
}
