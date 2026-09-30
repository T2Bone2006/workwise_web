'use client';

import { useMemo, useState, useTransition, type JSX } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { CustomerPicker } from '@/components/payments/customer-picker';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  checkExistingDirectDebitsAction,
  ignoreExistingDirectDebitAction,
  linkExistingDirectDebitAction,
  unlinkExistingDirectDebitAction,
} from '@/lib/actions/direct-debit';
import type { ExistingDirectDebit } from '@/lib/data/direct-debit/existing';

type Data = {
  checkedAt: string | null;
  toLink: ExistingDirectDebit[];
  linked: ExistingDirectDebit[];
  ignored: ExistingDirectDebit[];
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function relativeTime(iso: string | null): string {
  if (!iso) return 'never';
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return 'never';
  const minutes = Math.round((Date.now() - then) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function setUpLabel(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `Set up ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

function summary(row: ExistingDirectDebit): string {
  return [
    row.payerName ?? 'Unnamed',
    row.payerEmail,
    row.payerPostcode,
    row.bankName || row.bankEnding ? `${row.bankName ?? 'Bank'}${row.bankEnding ? ` ••${row.bankEnding}` : ''}` : null,
    setUpLabel(row.mandateCreatedAt),
  ]
    .filter(Boolean)
    .join(' · ');
}

function matches(row: ExistingDirectDebit, query: string): boolean {
  if (!query) return true;
  const hay = [row.payerName, row.payerEmail, row.payerPostcode].join(' ').toLowerCase();
  return hay.includes(query);
}

export function ExistingDirectDebits(props: {
  data: Data;
  customers: { id: string; name: string }[];
}): JSX.Element {
  const { data, customers } = props;
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const [someoneElse, setSomeoneElse] = useState<Record<string, boolean>>({});
  const [unlinking, setUnlinking] = useState<ExistingDirectDebit | null>(null);
  const q = query.trim().toLowerCase();

  const toLink = useMemo(() => data.toLink.filter((r) => matches(r, q)), [data.toLink, q]);
  const linked = useMemo(() => data.linked.filter((r) => matches(r, q)), [data.linked, q]);
  const ignored = useMemo(() => data.ignored.filter((r) => matches(r, q)), [data.ignored, q]);
  const nameOf = (id: string) => customers.find((c) => c.id === id)?.name ?? 'customer';

  function check() {
    startTransition(async () => {
      const result = await checkExistingDirectDebitsAction();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const s = result.summary;
      toast.success(
        `Found ${s.found}: ${s.autoLinked} linked automatically, ${s.probable} to confirm, ${s.unmatched} to match`,
      );
    });
  }

  function link(row: ExistingDirectDebit, customerId: string, confirmStoppedOldApp: boolean, name: string) {
    startTransition(async () => {
      const result = await linkExistingDirectDebitAction({
        linkId: row.linkId,
        customerId,
        confirmStoppedOldApp,
      });
      if (!result.ok) toast.error(result.error);
      else toast.success(`Linked to ${name}`);
    });
  }

  function ignore(row: ExistingDirectDebit) {
    startTransition(async () => {
      const result = await ignoreExistingDirectDebitAction({ linkId: row.linkId });
      if (!result.ok) toast.error(result.error);
      else toast.success('Ignored');
    });
  }

  function unlink(row: ExistingDirectDebit, message: string) {
    startTransition(async () => {
      const result = await unlinkExistingDirectDebitAction({ linkId: row.linkId });
      setUnlinking(null);
      if (!result.ok) toast.error(result.error);
      else toast.success(message);
    });
  }

  function renderToLink(row: ExistingDirectDebit): JSX.Element {
    const otherApp = row.otherCollections > 0;
    const suggested = row.suggested;
    const probable = !otherApp && row.matchKind !== 'none' && suggested != null && !someoneElse[row.linkId];
    const chosen = picked[row.linkId] ?? (otherApp ? suggested?.customerId : undefined);
    const canLink = Boolean(chosen) && (!otherApp || ticked[row.linkId] === true);

    return (
      <li key={row.linkId} className="space-y-2 rounded-lg border border-border/60 p-3 text-sm">
        <p className="font-medium">{summary(row)}</p>
        {otherApp ? (
          <p className="rounded-md bg-amber-500/10 px-2 py-1 text-amber-800 dark:text-amber-300">
            <span className="font-medium">Another app is still collecting</span>
            {row.otherCollectionsDetail ? ` — ${row.otherCollectionsDetail}` : ''}
          </p>
        ) : null}

        {probable && suggested ? (
          <div className="flex flex-wrap items-center gap-2">
            <span>Probably {suggested.name}</span>
            <Button
              size="sm"
              disabled={pending}
              onClick={() => link(row, suggested.customerId, false, suggested.name)}
            >
              Yes, link to {firstName(suggested.name)}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => setSomeoneElse((s) => ({ ...s, [row.linkId]: true }))}
            >
              Someone else…
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <CustomerPicker
              customers={customers}
              value={chosen}
              onChange={(id) => setPicked((p) => ({ ...p, [row.linkId]: id }))}
              disabled={pending}
            />
            {otherApp ? (
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="size-4"
                  checked={ticked[row.linkId] === true}
                  onChange={(e) => setTicked((t) => ({ ...t, [row.linkId]: e.target.checked }))}
                />
                I&apos;ve stopped collecting in my old app
              </label>
            ) : null}
            <Button
              size="sm"
              disabled={pending || !canLink}
              onClick={() => chosen && link(row, chosen, otherApp && ticked[row.linkId] === true, nameOf(chosen))}
            >
              Link
            </Button>
          </div>
        )}

        <button
          type="button"
          className="text-xs text-muted-foreground hover:underline"
          disabled={pending}
          onClick={() => ignore(row)}
        >
          Ignore
        </button>
      </li>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={pending} onClick={check}>
          Check GoCardless again
        </Button>
        <span className="text-sm text-muted-foreground">Last checked {relativeTime(data.checkedAt)}</span>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, email or postcode"
          className="ml-auto w-full sm:w-72"
        />
      </div>

      <details open className="space-y-3">
        <summary className="cursor-pointer text-base font-semibold">
          To link ({toLink.length}
          {q && toLink.length !== data.toLink.length ? ` of ${data.toLink.length}` : ''})
        </summary>
        {toLink.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing to link right now.</p>
        ) : (
          <ul className="space-y-3">{toLink.map(renderToLink)}</ul>
        )}
      </details>

      <details className="space-y-3">
        <summary className="cursor-pointer text-base font-semibold">Linked ({linked.length})</summary>
        {linked.length === 0 ? (
          <p className="text-sm text-muted-foreground">None yet.</p>
        ) : (
          <ul className="space-y-2">
            {linked.map((row) => (
              <li
                key={row.linkId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 p-3 text-sm"
              >
                <span>
                  {summary(row)}
                  {row.linked ? (
                    <>
                      {' → '}
                      <Link
                        href={`/customers/${row.linked.customerId}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {row.linked.name}
                      </Link>
                    </>
                  ) : null}
                  {row.linkedAutomatically ? (
                    <span className="ml-2 text-xs text-muted-foreground">Linked automatically</span>
                  ) : null}
                </span>
                {row.canUnlink ? (
                  <Button size="sm" variant="outline" disabled={pending} onClick={() => setUnlinking(row)}>
                    Unlink
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </details>

      <details className="space-y-3">
        <summary className="cursor-pointer text-base font-semibold">Ignored ({ignored.length})</summary>
        {ignored.length === 0 ? (
          <p className="text-sm text-muted-foreground">None ignored.</p>
        ) : (
          <ul className="space-y-2">
            {ignored.map((row) => (
              <li
                key={row.linkId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 p-3 text-sm"
              >
                <span>{summary(row)}</span>
                <Button size="sm" variant="outline" disabled={pending} onClick={() => unlink(row, 'Undone')}>
                  Undo
                </Button>
              </li>
            ))}
          </ul>
        )}
      </details>

      <Dialog open={unlinking != null} onOpenChange={(open) => !open && setUnlinking(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Unlink this Direct Debit?</DialogTitle>
            <DialogDescription>
              Unlink this Direct Debit from {unlinking?.linked?.name ?? 'this customer'}? Nothing
              changes in GoCardless.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUnlinking(null)}>
              Keep it linked
            </Button>
            <Button disabled={pending} onClick={() => unlinking && unlink(unlinking, 'Unlinked')}>
              Unlink
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
