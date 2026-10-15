'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BusinessMark } from '@/components/look';
import { Input } from '@/components/ui/input';

type Step = 'start' | 'code';

/** "We'll email you a code" → type it in. The code goes in the cookie only on success. */
export function SignInPanel({
  token,
  businessName,
  maskedEmail,
}: {
  token: string;
  businessName: string;
  maskedEmail: string;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>('start');
  const [code, setCode] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const call = async (path: 'code' | 'verify', body?: unknown) => {
    const res = await fetch(`/api/accountant/${encodeURIComponent(token)}/${path}`, {
      method: 'POST',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: res.ok, error: json.error ?? "Couldn't do that. Try again." };
  };

  const sendCode = async () => {
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const result = await call('code');
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setStep('code');
      setNotice(`We've sent a code to ${maskedEmail}.`);
    } catch {
      setError("Couldn't send a code. Try again.");
    } finally {
      setPending(false);
    }
  };

  const verify = async (e: FormEvent) => {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const result = await call('verify', { code: code.trim() });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    } catch {
      setError("Couldn't check that. Try again.");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-md">
      <div className="mb-4 flex items-center gap-3 px-1">
        <BusinessMark name={businessName} logoUrl={null} size="lg" />
        <h1 className="text-xl font-semibold tracking-tight">{businessName}&apos;s books</h1>
      </div>
      <div className="rounded-3xl border border-border bg-card p-6 shadow-(--look-card-shadow)">
        <div className="space-y-4">
          {step === 'start' ? (
            <>
              <p className="text-sm text-muted-foreground">
                We&apos;ll email a 6-digit code to {maskedEmail}.
              </p>
              <Button className="h-11 w-full rounded-full" disabled={pending} onClick={sendCode}>
                {pending ? <Loader2 className="size-4 animate-spin" /> : null} Email me a code
              </Button>
            </>
          ) : (
            <form onSubmit={verify} className="space-y-3">
              {notice ? <p className="text-sm text-muted-foreground">{notice}</p> : null}
              <Input
                aria-label="6-digit code"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                maxLength={6}
                placeholder="000000"
                className="text-center text-2xl tracking-[0.4em]"
                value={code}
                onChange={(e) => {
                  setError(null);
                  setCode(e.target.value.replace(/\D/g, '').slice(0, 6));
                }}
              />
              <Button type="submit" className="h-11 w-full rounded-full" disabled={pending || code.length !== 6}>
                {pending ? <Loader2 className="size-4 animate-spin" /> : null} Open the books
              </Button>
              <button
                type="button"
                className="block w-full text-center text-sm text-primary hover:underline disabled:opacity-50"
                disabled={pending}
                onClick={sendCode}
              >
                Send a new code
              </button>
            </form>
          )}
          {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
        </div>
      </div>
      <p className="mt-4 text-center text-xs text-muted-foreground">
        Read-only access. Nothing here can be changed.
      </p>
    </div>
  );
}
