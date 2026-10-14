'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Check, Layers, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { fetchHeaderCountsAction, saveFieldGroups } from '@/lib/actions/field-groups';
import type { HeaderCount } from '@/lib/data/field-groups';
import { ungroupedHeaders, type FieldGroup } from '@/lib/jobs/field-groups';
import { cn } from '@/lib/utils';

interface SettingsFieldGroupsSectionProps {
  initialGroups: FieldGroup[];
  onSaved: () => void;
}

const draft = (g: FieldGroup) => ({ id: g.id, name: g.name, aliases: g.aliases });

/**
 * Settings → Job fields. One named field bundles the spreadsheet columns that
 * all mean the same thing, so the jobs screen can filter and show them as one.
 * Nothing on a stored job changes; groups are applied when jobs are read.
 */
export function SettingsFieldGroupsSection({
  initialGroups,
  onSaved,
}: SettingsFieldGroupsSectionProps) {
  const [groups, setGroups] = useState<FieldGroup[]>(initialGroups);
  const [counts, setCounts] = useState<HeaderCount[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [saving, setSaving] = useState(false);

  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [deleteTarget, setDeleteTarget] = useState<FieldGroup | null>(null);

  useEffect(() => {
    setGroups(initialGroups);
  }, [initialGroups]);

  useEffect(() => {
    let alive = true;
    void fetchHeaderCountsAction().then((r) => {
      if (!alive) return;
      setCounts(r.headers);
      setTruncated(r.truncated);
    });
    return () => {
      alive = false;
    };
  }, []);

  const countOf = useMemo(() => new Map((counts ?? []).map((c) => [c.header, c.jobs])), [counts]);
  const headerNames = useMemo(() => (counts ?? []).map((c) => c.header), [counts]);
  const free = useMemo(() => ungroupedHeaders(headerNames, groups), [headerNames, groups]);

  async function persist(next: FieldGroup[], done?: string): Promise<boolean> {
    setSaving(true);
    const result = await saveFieldGroups(next.map(draft));
    setSaving(false);
    if (!result.success) {
      toast.error(result.error);
      return false;
    }
    setGroups(result.groups);
    if (done) toast.success(done);
    onSaved();
    return true;
  }

  async function addField(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    const ok = await persist([...groups, { id: '', name, aliases: [] }], `Added “${name}”`);
    if (ok) setNewName('');
  }

  function addAlias(group: FieldGroup, header: string) {
    const h = header.trim();
    if (!h) return;
    void persist(groups.map((g) => (g.id === group.id ? { ...g, aliases: [...g.aliases, h] } : g)));
  }

  function removeAlias(group: FieldGroup, header: string) {
    void persist(
      groups.map((g) =>
        g.id === group.id ? { ...g, aliases: g.aliases.filter((a) => a !== header) } : g
      )
    );
  }

  async function saveRename(group: FieldGroup) {
    const name = editName.trim();
    if (!name || name === group.name) {
      setEditingId(null);
      return;
    }
    const ok = await persist(groups.map((g) => (g.id === group.id ? { ...g, name } : g)), 'Renamed');
    if (ok) setEditingId(null);
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    await persist(groups.filter((g) => g.id !== target.id), `Removed “${target.name}”`);
  }

  const jobsLabel = (header: string) => {
    const n = countOf.get(header);
    if (n == null) return null;
    return `${n.toLocaleString('en-GB')} job${n === 1 ? '' : 's'}`;
  };

  return (
    <>
      <Card
        className={cn(
          'glass-card rounded-xl border border-border/60',
          'bg-card/80 backdrop-blur-[var(--blur-glass)]'
        )}
      >
        <CardHeader>
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Layers className="size-4.5" aria-hidden />
            </span>
            <div className="space-y-1">
              <CardTitle>Job fields</CardTitle>
              <CardDescription>
                Spreadsheets don&apos;t always call things the same name. Bundle the columns that
                mean the same thing into one field, for example{' '}
                <span className="font-medium text-foreground">Warrant Officer</span> for{' '}
                <span className="font-mono text-xs">W/O</span> and{' '}
                <span className="font-mono text-xs">B/R Name</span>. The Jobs screen then filters
                and shows it as one. Your jobs aren&apos;t changed.
              </CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-5">
          {groups.length > 0 && (
            <ul className="space-y-3">
              {groups.map((group) => {
                const addable = free;
                const typedValue = typed[group.id] ?? '';
                return (
                  <li
                    key={group.id}
                    className="space-y-3 rounded-xl border border-border/60 bg-background/40 p-4"
                  >
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      {editingId === group.id ? (
                        <form
                          className="flex flex-1 items-center gap-2"
                          onSubmit={(e) => {
                            e.preventDefault();
                            void saveRename(group);
                          }}
                        >
                          <Input
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            maxLength={60}
                            autoFocus
                            className="h-9 max-w-xs"
                            aria-label="Field name"
                          />
                          <Button type="submit" size="sm" variant="gradient" disabled={saving}>
                            Save
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => setEditingId(null)}
                          >
                            Cancel
                          </Button>
                        </form>
                      ) : (
                        <>
                          <div className="min-w-0">
                            <p className="truncate text-base font-semibold text-foreground">
                              {group.name}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {group.aliases.length === 0
                                ? 'No columns yet'
                                : `${group.aliases.length} column${group.aliases.length === 1 ? '' : 's'} bundled`}
                            </p>
                          </div>
                          <div className="flex shrink-0 gap-1 sm:justify-end">
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="gap-1.5"
                              onClick={() => {
                                setEditingId(group.id);
                                setEditName(group.name);
                              }}
                            >
                              <Pencil className="size-3.5" aria-hidden />
                              Rename
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
                              onClick={() => setDeleteTarget(group)}
                            >
                              <Trash2 className="size-3.5" aria-hidden />
                              Delete
                            </Button>
                          </div>
                        </>
                      )}
                    </div>

                    {group.aliases.length > 0 && (
                      <ul className="flex flex-wrap gap-2">
                        {group.aliases.map((alias) => (
                          <li
                            key={alias}
                            className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-primary/25 bg-primary/10 py-1 pl-2.5 pr-1 text-sm"
                          >
                            <span className="truncate font-medium text-foreground" title={alias}>
                              {alias}
                            </span>
                            {jobsLabel(alias) && (
                              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                                {jobsLabel(alias)}
                              </span>
                            )}
                            <button
                              type="button"
                              disabled={saving}
                              onClick={() => removeAlias(group, alias)}
                              className="rounded-md p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
                              aria-label={`Take ${alias} out of ${group.name}`}
                            >
                              <X className="size-3.5" aria-hidden />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}

                    <div className="flex flex-col gap-2">
                      <div>
                        <SearchableSelect
                          value="__none__"
                          onValueChange={(v) => v !== '__none__' && addAlias(group, v)}
                          placeholder={
                            counts === null
                              ? 'Reading your columns…'
                              : addable.length === 0
                                ? 'No other columns found'
                                : 'Add a column…'
                          }
                          searchPlaceholder="Search columns…"
                          emptyText="No more columns."
                          disabled={saving || counts === null || addable.length === 0}
                          className="h-9"
                          options={addable.map((h) => ({
                            value: h,
                            label: jobsLabel(h) ? `${h} · ${jobsLabel(h)}` : h,
                          }))}
                        />
                      </div>
                      <form
                        className="flex items-center gap-2"
                        onSubmit={(e) => {
                          e.preventDefault();
                          addAlias(group, typedValue);
                          setTyped((t) => ({ ...t, [group.id]: '' }));
                        }}
                      >
                        <Input
                          value={typedValue}
                          onChange={(e) => setTyped((t) => ({ ...t, [group.id]: e.target.value }))}
                          placeholder="or type a column name"
                          maxLength={120}
                          className="h-9 w-full"
                          aria-label={`Type a column name to add to ${group.name}`}
                        />
                        <Button
                          type="submit"
                          size="sm"
                          variant="outline"
                          disabled={saving || !typedValue.trim()}
                          aria-label="Add typed column"
                        >
                          <Check className="size-4" aria-hidden />
                        </Button>
                      </form>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          <form
            onSubmit={addField}
            className="space-y-3 rounded-lg border border-border/40 bg-muted/20 p-4"
          >
            <p className="text-sm font-medium text-foreground">
              {groups.length === 0 ? 'Make your first field' : 'Add a field'}
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Warrant Officer"
                maxLength={60}
                autoComplete="off"
                className="sm:max-w-xs"
                aria-label="New field name"
              />
              <Button
                type="submit"
                variant="gradient"
                disabled={saving || !newName.trim()}
                className="gap-2"
              >
                {saving ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <Plus className="size-4" aria-hidden />
                )}
                Add field
              </Button>
            </div>
          </form>

          <p className="text-xs text-muted-foreground">
            {counts === null
              ? 'Reading the columns on your jobs…'
              : free.length === 0
                ? 'Every column on your jobs is in a field.'
                : `${free.length} column${free.length === 1 ? ' is' : 's are'} not in a field yet. They stay under “Other columns” on the Jobs screen.`}
            {truncated && ' Counts are from your most recent 5,000 jobs.'}
          </p>
        </CardContent>
      </Card>

      <Dialog open={deleteTarget != null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete this field?</DialogTitle>
            <DialogDescription>
              “{deleteTarget?.name}” stops appearing as a filter and column on the Jobs screen. Your
              jobs and their spreadsheet columns are untouched, and the columns go back to “Other
              columns”.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" onClick={() => void confirmDelete()}>
              Delete field
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
