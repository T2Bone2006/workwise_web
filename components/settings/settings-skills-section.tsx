'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label as FormLabel } from '@/components/ui/label';
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
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  addTenantSkill,
  deleteTenantSkill,
  updateTenantSkill,
  type TenantSkillRow,
} from '@/lib/actions/skills';
import { cn } from '@/lib/utils';

/** Suggest a valid lowercase snake_case key from a display label (best-effort). */
function labelToSuggestedSkillKey(label: string): string {
  const raw = label
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
  if (!raw) return '';
  const body = raw.replace(/^[^a-z]+/, '');
  if (!body) return '';
  return /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/.test(body) ? body : '';
}

interface SettingsSkillsSectionProps {
  tenantId: string;
  initialSkills: TenantSkillRow[];
  onSaved: () => void;
}

export function SettingsSkillsSection({
  tenantId,
  initialSkills,
  onSaved,
}: SettingsSkillsSectionProps) {
  const [skills, setSkills] = useState<TenantSkillRow[]>(initialSkills);
  const [newLabel, setNewLabel] = useState('');
  const [newKey, setNewKey] = useState('');
  const [keyTouched, setKeyTouched] = useState(false);
  const [adding, setAdding] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [savingEditId, setSavingEditId] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<TenantSkillRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setSkills(initialSkills);
  }, [initialSkills]);

  useEffect(() => {
    if (keyTouched) return;
    const suggested = labelToSuggestedSkillKey(newLabel);
    setNewKey(suggested);
  }, [newLabel, keyTouched]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const label = newLabel.trim();
    const key = newKey.trim();
    if (!label || !key) {
      toast.error('Label and key are required.');
      return;
    }
    setAdding(true);
    const result = await addTenantSkill(key, label);
    setAdding(false);
    if (result.success) {
      toast.success('Skill added');
      setNewLabel('');
      setNewKey('');
      setKeyTouched(false);
      onSaved();
    } else {
      toast.error(result.error);
    }
  }

  function startEdit(skill: TenantSkillRow) {
    setEditingId(skill.id);
    setEditLabel(skill.label);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditLabel('');
  }

  async function saveEdit(skillId: string) {
    const label = editLabel.trim();
    if (!label) {
      toast.error('Label is required.');
      return;
    }
    setSavingEditId(skillId);
    const result = await updateTenantSkill(skillId, label);
    setSavingEditId(null);
    if (result.success) {
      toast.success('Skill updated');
      setEditingId(null);
      setEditLabel('');
      onSaved();
    } else {
      toast.error(result.error);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    const result = await deleteTenantSkill(deleteTarget.id);
    setDeleting(false);
    setDeleteTarget(null);
    if (result.success) {
      toast.success('Skill deleted');
      onSaved();
    } else {
      toast.error(result.error);
    }
  }

  return (
    <>
      <Card
        className={cn(
          'glass-card rounded-xl border border-border/60',
          'bg-card/80 backdrop-blur-[var(--blur-glass)]'
        )}
      >
        <CardHeader>
          <CardTitle>Skills</CardTitle>
          <CardDescription>
            Define skills for your team. These keys are used when matching workers to jobs.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {skills.length === 0 && (
            <Alert className="border-amber-500/40 bg-amber-500/5">
              <AlertTriangle className="size-4 text-amber-600 dark:text-amber-500" />
              <AlertTitle>No skills yet</AlertTitle>
              <AlertDescription>
                Add at least one skill so jobs and workers can be matched consistently. Without
                skills, auto-assignment may not find the right people.
              </AlertDescription>
            </Alert>
          )}

          {skills.length > 0 && (
            <ul className="divide-y divide-border rounded-lg border border-border/60">
              {skills.map((skill) => (
                <li
                  key={skill.id}
                  className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    {editingId === skill.id ? (
                      <div className="flex max-w-md flex-col gap-2 sm:flex-row sm:items-end">
                        <div className="flex-1 space-y-1.5">
                          <FormLabel htmlFor={`edit-label-${skill.id}`}>Label</FormLabel>
                          <Input
                            id={`edit-label-${skill.id}`}
                            value={editLabel}
                            onChange={(e) => setEditLabel(e.target.value)}
                            placeholder="Display name"
                          />
                        </div>
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={cancelEdit}
                            disabled={savingEditId === skill.id}
                          >
                            Cancel
                          </Button>
                          <Button
                            type="button"
                            variant="gradient"
                            size="sm"
                            className="gap-2"
                            onClick={() => saveEdit(skill.id)}
                            disabled={savingEditId === skill.id}
                          >
                            {savingEditId === skill.id && (
                              <Loader2 className="size-4 animate-spin" aria-hidden />
                            )}
                            Save
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <p className="font-medium text-foreground">{skill.label}</p>
                        <p className="font-mono text-xs text-muted-foreground">{skill.key}</p>
                      </>
                    )}
                  </div>
                  {editingId !== skill.id && (
                    <div className="flex shrink-0 gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="gap-2"
                        onClick={() => startEdit(skill)}
                      >
                        <Pencil className="size-4" />
                        Edit
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="gap-2 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => setDeleteTarget(skill)}
                      >
                        <Trash2 className="size-4" />
                        Delete
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}

          <form onSubmit={handleAdd} className="space-y-4 rounded-lg border border-border/40 bg-muted/20 p-4">
            <p className="text-sm font-medium text-foreground">Add skill</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <FormLabel htmlFor="skill-label">Label</FormLabel>
                <Input
                  id="skill-label"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  placeholder="e.g. Lock fitting"
                  autoComplete="off"
                />
              </div>
              <div className="space-y-2">
                <FormLabel htmlFor="skill-key">Key</FormLabel>
                <Input
                  id="skill-key"
                  value={newKey}
                  onChange={(e) => {
                    setKeyTouched(true);
                    setNewKey(e.target.value);
                  }}
                  placeholder="e.g. lock_fitting"
                  className="font-mono text-sm"
                  autoComplete="off"
                />
                <p className="text-xs text-muted-foreground">
                  Lowercase snake_case. Filled from the label until you edit it.
                </p>
              </div>
            </div>
            <Button type="submit" variant="gradient" disabled={adding} className="gap-2">
              {adding ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Plus className="size-4" aria-hidden />
              )}
              Add skill
            </Button>
          </form>
        </CardContent>
      </Card>

      <Dialog open={deleteTarget != null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete skill</DialogTitle>
            <DialogDescription>
              Remove &quot;{deleteTarget?.label}&quot; ({deleteTarget?.key})? Existing job or worker data
              that references this key may need to be updated manually.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="gap-2"
              onClick={confirmDelete}
              disabled={deleting}
            >
              {deleting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
