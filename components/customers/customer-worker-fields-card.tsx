'use client';

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ArrowDown, ArrowUp, Info, Loader2, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { updateCustomerWorkerFields } from '@/lib/actions/customers';
import type { WorkerVisibleField } from '@/lib/jobs/worker-visible-fields';
import { cn } from '@/lib/utils';

interface CustomerWorkerFieldsCardProps {
  customerId: string;
  initialFields: WorkerVisibleField[];
  newKeys: string[];
  neverConfigured: boolean;
}

function move(fields: WorkerVisibleField[], from: number, to: number): WorkerVisibleField[] {
  if (to < 0 || to >= fields.length) return fields;
  const next = [...fields];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export function CustomerWorkerFieldsCard({
  customerId,
  initialFields,
  newKeys,
  neverConfigured,
}: CustomerWorkerFieldsCardProps) {
  const [fields, setFields] = useState<WorkerVisibleField[]>(initialFields);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const newKeySet = useMemo(() => new Set(newKeys), [newKeys]);

  const shown = fields.filter((f) => f.enabled);
  const hidden = fields.filter((f) => !f.enabled);

  const update = (next: WorkerVisibleField[]) => {
    setFields(next);
    setDirty(true);
  };

  const setEnabled = (key: string, enabled: boolean) => {
    update(fields.map((f) => (f.key === key ? { ...f, enabled } : f)));
  };

  const setLabel = (key: string, label: string) => {
    update(fields.map((f) => (f.key === key ? { ...f, label } : f)));
  };

  /** Indices are per-list, so reordering works on the shown subset. */
  const reorder = (key: string, direction: -1 | 1) => {
    const shownKeys = shown.map((f) => f.key);
    const from = shownKeys.indexOf(key);
    const reordered = move(shown, from, from + direction);
    update([...reordered, ...hidden]);
  };

  const onSave = async () => {
    setSaving(true);
    const result = await updateCustomerWorkerFields(customerId, fields);
    setSaving(false);
    if (result.success) {
      setDirty(false);
      toast.success('Job screen fields saved', { duration: 4000 });
    } else {
      toast.error(result.error ?? 'Could not save fields', { duration: 8000 });
    }
  };

  return (
    <Card className="border-[var(--glass-border)] bg-[var(--glass-bg)]">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-foreground">Worker app fields</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Columns from this customer&rsquo;s imports, shown on the worker&rsquo;s job screen
              in this order.
            </p>
          </div>
          <Button onClick={onSave} disabled={!dirty || saving} size="sm">
            {saving ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
            Save
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="flex gap-2.5 rounded-lg border border-[var(--glass-border)] bg-muted/40 p-3 text-sm text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" />
          <p>
            The job screen already shows the address, postcode, reference number and scheduled
            time. You don&rsquo;t need to select those columns here.
          </p>
        </div>

        {fields.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">
            No imported columns yet. They appear here after this customer&rsquo;s first import.
          </p>
        ) : (
          <>
            {neverConfigured ? (
              <p className="text-sm text-muted-foreground">
                Nothing configured yet, so every column is showing. Turn off the ones workers
                don&rsquo;t need, then save.
              </p>
            ) : null}

            <div className="space-y-2">
              {shown.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nothing shown. Workers see only the standard job details.
                </p>
              ) : null}
              {shown.map((field, index) => (
                <div
                  key={field.key}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--glass-border)] bg-background/40 p-2 sm:flex-nowrap"
                >
                  <Input
                    value={field.label}
                    onChange={(e) => setLabel(field.key, e.target.value)}
                    aria-label={`Label shown to workers for ${field.source_header}`}
                    className="h-9 min-w-0 flex-1"
                  />
                  <span
                    className="min-w-0 shrink truncate font-mono text-xs text-muted-foreground"
                    title={field.source_header}
                  >
                    &larr; {field.source_header}
                  </span>
                  {newKeySet.has(field.key) ? (
                    <span className="rounded-full border border-amber-400/60 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
                      New
                    </span>
                  ) : null}
                  <div className="ml-auto flex shrink-0 items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      onClick={() => reorder(field.key, -1)}
                      disabled={index === 0}
                      aria-label={`Move ${field.label} up`}
                    >
                      <ArrowUp className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      onClick={() => reorder(field.key, 1)}
                      disabled={index === shown.length - 1}
                      aria-label={`Move ${field.label} down`}
                    >
                      <ArrowDown className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      onClick={() => setEnabled(field.key, false)}
                      aria-label={`Hide ${field.label} from workers`}
                    >
                      <X className="size-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            {hidden.length > 0 ? (
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Hidden &mdash; click to show
                </p>
                <div className="flex flex-wrap gap-2">
                  {hidden.map((field) => (
                    <button
                      key={field.key}
                      type="button"
                      onClick={() => setEnabled(field.key, true)}
                      className={cn(
                        'rounded-full border border-[var(--glass-border)] bg-background/40 px-3 py-1 text-sm text-muted-foreground',
                        'transition-colors hover:border-foreground/30 hover:text-foreground',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                      )}
                    >
                      <Plus className="mr-1 inline size-3" />
                      {field.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
