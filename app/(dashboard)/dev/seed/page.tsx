'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Users, Trash2, Loader2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export default function DevSeedPage() {
  const [seedCount, setSeedCount] = useState(30);
  const [seedWorkerCount, setSeedWorkerCount] = useState<number | null>(null);
  const [loading, setLoading] = useState<'seed' | 'wipe' | null>(null);

  async function fetchSeedCount() {
    try {
      const res = await fetch('/api/seed/workers');
      if (res.ok) {
        const data = await res.json();
        setSeedWorkerCount(data.seedCount ?? 0);
      } else {
        setSeedWorkerCount(null);
      }
    } catch {
      setSeedWorkerCount(null);
    }
  }

  useEffect(() => {
    fetchSeedCount();
  }, []);

  async function handleSeed() {
    setLoading('seed');
    try {
      const res = await fetch('/api/seed/workers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count: seedCount }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Failed to seed workers');
        return;
      }
      toast.success(data.message ?? `Created ${data.created} seed workers`);
      await fetchSeedCount();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setLoading(null);
    }
  }

  async function handleWipe() {
    if (seedWorkerCount === 0) {
      toast.info('No seed workers to remove');
      return;
    }
    if (!confirm(`Remove all ${seedWorkerCount} seed workers? Jobs assigned to them will be unassigned.`)) {
      return;
    }
    setLoading('wipe');
    try {
      const res = await fetch('/api/seed/workers', { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Failed to wipe seed workers');
        return;
      }
      toast.success(data.message ?? `Removed ${data.deleted} seed workers`);
      await fetchSeedCount();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Seed workers (dev only)
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Create or remove temporary workers for testing. Wipe before production.
        </p>
      </div>

      <div
        className={cn(
          'rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 flex items-start gap-3'
        )}
      >
        <AlertTriangle className="size-5 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="text-sm text-amber-800 dark:text-amber-200">
          <strong>Dev only.</strong> Seed workers use the email domain <code className="rounded bg-amber-500/20 px-1">@seed.workwise.local</code> so
          they can be removed in one go. Delete all seed workers before going to production.
        </div>
      </div>

      <Card className="glass-card border-border/80">
        <CardHeader>
          <h2 className="text-base font-semibold">Seed workers</h2>
          <p className="text-sm text-muted-foreground">
            Creates workers across the UK with random postcodes and 0–5 skills each. All belong to your tenant.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-2">
              <Label htmlFor="seed-count">Number of workers (1–100)</Label>
              <Input
                id="seed-count"
                type="number"
                min={1}
                max={100}
                value={seedCount}
                onChange={(e) => setSeedCount(Math.min(100, Math.max(1, parseInt(e.target.value, 10) || 1)))}
                className="w-24"
              />
            </div>
            <Button
              variant="gradient"
              onClick={handleSeed}
              disabled={loading !== null}
            >
              {loading === 'seed' ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Users className="size-4" />
              )}
              <span className="ml-2">Create seed workers</span>
            </Button>
          </div>
          {seedWorkerCount !== null && (
            <p className="text-sm text-muted-foreground">
              Current seed workers in your tenant: <strong>{seedWorkerCount}</strong>
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="glass-card border-border/80">
        <CardHeader>
          <h2 className="text-base font-semibold">Wipe seed workers</h2>
          <p className="text-sm text-muted-foreground">
            Permanently delete all workers with email ending in @seed.workwise.local. Jobs assigned to them are unassigned.
          </p>
        </CardHeader>
        <CardContent>
          <Button
            variant="destructive"
            onClick={handleWipe}
            disabled={loading !== null || seedWorkerCount === 0}
          >
            {loading === 'wipe' ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Trash2 className="size-4" />
            )}
            <span className="ml-2">Remove all seed workers</span>
          </Button>
        </CardContent>
      </Card>

      <Card className="glass-card border-border/80">
        <CardHeader>
          <h2 className="text-base font-semibold">How to use (API)</h2>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground font-mono">
          <p>Create 30 workers (default):</p>
          <pre className="rounded bg-muted/50 p-3 overflow-x-auto">
            fetch(&apos;/api/seed/workers&apos;, &#123; method: &apos;POST&apos;, headers: &#123; &apos;Content-Type&apos;: &apos;application/json&apos; &#125;, body: JSON.stringify(&#123; count: 30 &#125;) &#125;)
          </pre>
          <p>Create 50 workers:</p>
          <pre className="rounded bg-muted/50 p-3 overflow-x-auto">
            fetch(&apos;/api/seed/workers&apos;, &#123; method: &apos;POST&apos;, headers: &#123; &apos;Content-Type&apos;: &apos;application/json&apos; &#125;, body: JSON.stringify(&#123; count: 50 &#125;) &#125;)
          </pre>
          <p>Wipe all seed workers:</p>
          <pre className="rounded bg-muted/50 p-3 overflow-x-auto">
            fetch(&apos;/api/seed/workers&apos;, &#123; method: &apos;DELETE&apos; &#125;)
          </pre>
          <p className="pt-2 text-foreground">
            You must be logged in; workers are created for your tenant. Run wipe before production.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
