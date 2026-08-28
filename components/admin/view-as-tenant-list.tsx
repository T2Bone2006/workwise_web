'use client';

import { useMemo, useState, useTransition } from 'react';
import { Eye, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { TenantListItem } from '@/lib/actions/impersonation';

export function ViewAsTenantList({ tenants }: { tenants: TenantListItem[] }) {
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tenants;
    return tenants.filter(
      (t) => t.name.toLowerCase().includes(q) || t.id.toLowerCase().includes(q)
    );
  }, [tenants, query]);

  const startViewAs = (tenantId: string) => {
    setError(null);
    setPendingId(tenantId);
    startTransition(async () => {
      try {
        const res = await fetch('/api/admin/view-as/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tenantId }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          redirectTo?: string;
        };
        if (!res.ok) {
          setError(data.error ?? 'Failed to start view-as');
          setPendingId(null);
          return;
        }
        window.location.assign(data.redirectTo ?? '/dashboard');
      } catch {
        setError('Failed to start view-as');
        setPendingId(null);
      }
    });
  };

  return (
    <div className="space-y-4">
      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search tenants…"
          className="pl-9"
          aria-label="Search tenants"
        />
      </div>

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      <ul className="divide-y rounded-lg border">
        {filtered.length === 0 ? (
          <li className="px-4 py-8 text-center text-sm text-muted-foreground">
            No tenants match your search.
          </li>
        ) : (
          filtered.map((tenant) => {
            const loading = isPending && pendingId === tenant.id;
            return (
              <li
                key={tenant.id}
                className="flex items-center justify-between gap-4 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{tenant.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{tenant.id}</p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={isPending}
                  onClick={() => startViewAs(tenant.id)}
                >
                  <Eye className="size-4" />
                  {loading ? 'Opening…' : 'View dashboard'}
                </Button>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}
