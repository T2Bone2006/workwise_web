'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  ArrowDown,
  ArrowUp,
  Camera,
  CornerDownRight,
  Eye,
  Flag,
  List,
  ListChecks,
  Loader2,
  Lock,
  MoreHorizontal,
  Pencil,
  PenLine,
  Plus,
  ToggleLeft,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { saveJobReportFields } from '@/lib/actions/job-report-fields';
import {
  answerChoices,
  blockingAnswerOf,
  flattenJobReportTree,
  followUpAnswerAfterEdit,
  followUpInsertIndex,
  formatShowWhenValue,
  jobReportTree,
  MAX_OPTIONS,
  type EditedChoice,
  type JobReportAnswerType,
  type JobReportField,
  type JobReportFieldInput,
  type JobReportNode,
} from '@/lib/jobs/job-report-fields';
import { cn } from '@/lib/utils';
import { JobReportPreview } from './job-report-preview';

interface SettingsJobReportSectionProps {
  initialFields: JobReportField[];
  onSaved: () => void;
}

type Placement =
  | { kind: 'edit'; fieldId: string }
  | { kind: 'new'; parentId: string | null; value: boolean | string | null };

interface Draft {
  label: string;
  type: JobReportAnswerType;
  choices: EditedChoice[];
  /** The Yes/No answer that means the job was not done. */
  blockYesNo: boolean | null;
  /** The list choice that means the job was not done. */
  blockIndex: number | null;
  multiline: boolean;
  mustFill: boolean;
}

const TYPES: { type: JobReportAnswerType; label: string; icon: typeof ToggleLeft }[] = [
  { type: 'yes_no', label: 'Yes / No', icon: ToggleLeft },
  { type: 'select', label: 'List of choices', icon: List },
  { type: 'text', label: 'Written answer', icon: PenLine },
];

function blankChoices(): EditedChoice[] {
  return [
    { text: '', from: null },
    { text: '', from: null },
  ];
}

function emptyDraft(): Draft {
  return {
    label: '',
    type: 'yes_no',
    choices: blankChoices(),
    blockYesNo: null,
    blockIndex: null,
    multiline: false,
    mustFill: true,
  };
}

function draftFromField(field: JobReportField): Draft {
  const blocking = blockingAnswerOf(field);
  const blockIndex = typeof blocking === 'string' ? field.options.indexOf(blocking) : -1;
  return {
    label: field.label,
    type: field.type,
    choices: field.type === 'select' ? field.options.map((text) => ({ text, from: text })) : blankChoices(),
    blockYesNo: typeof blocking === 'boolean' ? blocking : null,
    blockIndex: blockIndex >= 0 ? blockIndex : null,
    multiline: field.multiline,
    mustFill: field.required,
  };
}

function switchType(draft: Draft, type: JobReportAnswerType): Draft {
  if (type === draft.type) return draft;
  const next: Draft = { ...draft, type };
  if (type === 'select' && draft.type === 'yes_no' && draft.choices.every((c) => !c.text.trim())) {
    next.choices = [
      { text: 'Yes', from: true },
      { text: 'No', from: false },
    ];
    next.blockIndex = draft.blockYesNo === true ? 0 : draft.blockYesNo === false ? 1 : null;
  }
  if (type === 'yes_no' && draft.type === 'select') {
    const picked = draft.blockIndex != null ? draft.choices[draft.blockIndex]?.text.trim().toLowerCase() : null;
    next.blockYesNo = picked === 'yes' ? true : picked === 'no' ? false : null;
  }
  return next;
}

function AnswerPill({ label, notDone }: { label: string; notDone?: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium',
        notDone
          ? 'border-rose-300 bg-rose-500/10 text-rose-700 dark:border-rose-500/40 dark:text-rose-300'
          : 'border-border bg-background text-foreground'
      )}
    >
      {label}
      {notDone ? (
        <span className="inline-flex items-center gap-0.5 font-normal">
          <Flag className="size-3" aria-hidden />
          job not done
        </span>
      ) : null}
    </span>
  );
}

function WrittenBox({ multiline, mustFill }: { multiline: boolean; mustFill: boolean }) {
  return (
    <div
      className={cn(
        'flex max-w-md items-start rounded-lg border border-dashed border-border bg-background/60 px-3 text-xs text-muted-foreground',
        multiline ? 'h-14 pt-2' : 'h-9 items-center'
      )}
    >
      Written answer · {mustFill ? 'must be filled in' : 'can be left blank'}
    </div>
  );
}

function IfTheyAnswer({ label, notDone }: { label: string; notDone: boolean }) {
  return (
    <p className="mb-2 flex flex-wrap items-center gap-1.5 text-xs font-medium text-muted-foreground">
      <CornerDownRight className="size-3.5" aria-hidden />
      If they answer
      <AnswerPill label={label} notDone={notDone} />
      also ask
    </p>
  );
}

function StepLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-sm font-medium text-muted-foreground">{children}</p>;
}

function QuestionEditor({
  draft,
  onChange,
  context,
  isNew,
  forcedRequired,
  lostFollowUps,
  saving,
  onCancel,
  onSave,
}: {
  draft: Draft;
  onChange: (draft: Draft) => void;
  context: { parentLabel: string; answer: string; notDone: boolean } | null;
  isNew: boolean;
  forcedRequired: boolean;
  lostFollowUps: string[];
  saving: boolean;
  onCancel: () => void;
  onSave: () => void;
}) {
  const answers =
    draft.type === 'yes_no'
      ? [
          { key: 'yes', label: 'Yes', checked: draft.blockYesNo === true },
          { key: 'no', label: 'No', checked: draft.blockYesNo === false },
        ]
      : draft.choices.map((choice, index) => ({
          key: String(index),
          label: choice.text,
          checked: draft.blockIndex === index,
        }));
  const blockingLabel =
    draft.type === 'yes_no'
      ? draft.blockYesNo === true
        ? 'Yes'
        : draft.blockYesNo === false
          ? 'No'
          : null
      : draft.type === 'select' && draft.blockIndex != null
        ? draft.choices[draft.blockIndex]?.text.trim() || 'that'
        : null;

  function toggleBlocking(index: number, checked: boolean) {
    if (draft.type === 'yes_no') {
      onChange({ ...draft, blockYesNo: checked ? index === 0 : null });
    } else {
      onChange({ ...draft, blockIndex: checked ? index : null });
    }
  }

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        onSave();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel();
      }}
    >
      {context ? (
        <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <CornerDownRight className="size-3.5" aria-hidden />
          Follow-up, asked when they answer
          <AnswerPill label={context.answer} notDone={context.notDone} />
          to “{context.parentLabel}”
        </p>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor="report-question">Question</Label>
        <Input
          id="report-question"
          autoFocus
          value={draft.label}
          maxLength={140}
          className="h-11 text-base"
          placeholder="e.g. Was the customer in?"
          onChange={(e) => onChange({ ...draft, label: e.target.value })}
        />
      </div>

      <div className="space-y-1.5">
        <Label>How do they answer?</Label>
        <div className="grid grid-cols-3 gap-1 rounded-lg border border-border bg-muted/40 p-1">
          {TYPES.map(({ type, label, icon: Icon }) => {
            const active = draft.type === type;
            return (
              <button
                key={type}
                type="button"
                aria-pressed={active}
                onClick={() => onChange(switchType(draft, type))}
                className={cn(
                  'flex items-center justify-center gap-1.5 rounded-md px-2 py-2 text-sm font-medium transition-colors',
                  active
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <Icon className="size-4 shrink-0" aria-hidden />
                <span className="truncate">{label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {draft.type === 'text' ? (
        <div className="divide-y divide-border rounded-lg border border-border">
          <label htmlFor="report-must-fill" className="flex items-start justify-between gap-4 px-3 py-2.5">
            <span>
              <span className="block text-sm font-medium">Must be filled in</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {forcedRequired
                  ? 'Always, because it explains why the job was not done.'
                  : 'Turn off if the engineer can leave it blank.'}
              </span>
            </span>
            <Switch
              id="report-must-fill"
              className="mt-0.5"
              checked={forcedRequired || draft.mustFill}
              disabled={forcedRequired}
              onCheckedChange={(checked) => onChange({ ...draft, mustFill: checked })}
            />
          </label>
          <label htmlFor="report-multiline" className="flex items-start justify-between gap-4 px-3 py-2.5">
            <span>
              <span className="block text-sm font-medium">Bigger box</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">For a longer explanation.</span>
            </span>
            <Switch
              id="report-multiline"
              className="mt-0.5"
              checked={draft.multiline}
              onCheckedChange={(checked) => onChange({ ...draft, multiline: checked })}
            />
          </label>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-end justify-between gap-3">
            <Label>Answers</Label>
            <span className="text-xs text-muted-foreground">Tick if it means the job was not done</span>
          </div>
          <div className="space-y-2">
            {answers.map((answer, index) => (
              <div key={answer.key} className="flex items-center gap-2">
                {draft.type === 'yes_no' ? (
                  <div className="flex h-9 flex-1 items-center rounded-md border border-input bg-muted/30 px-3 text-sm">
                    {answer.label}
                  </div>
                ) : (
                  <Input
                    value={answer.label}
                    maxLength={80}
                    placeholder={`Choice ${index + 1}`}
                    aria-label={`Choice ${index + 1}`}
                    onChange={(e) => {
                      const choices = [...draft.choices];
                      choices[index] = { ...draft.choices[index]!, text: e.target.value };
                      onChange({ ...draft, choices });
                    }}
                  />
                )}
                <label
                  className={cn(
                    'flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded-md border px-3 text-xs font-medium transition-colors',
                    answer.checked
                      ? 'border-rose-300 bg-rose-500/10 text-rose-700 dark:border-rose-500/40 dark:text-rose-300'
                      : 'border-border text-muted-foreground hover:bg-muted'
                  )}
                >
                  <Checkbox
                    checked={answer.checked}
                    onCheckedChange={(value) => toggleBlocking(index, value === true)}
                    aria-label={`${answer.label || `Choice ${index + 1}`} means the job was not done`}
                  />
                  Job not done
                </label>
                {draft.type === 'select' ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-9 shrink-0 text-muted-foreground"
                    disabled={draft.choices.length <= 2}
                    aria-label={`Remove choice ${index + 1}`}
                    onClick={() => {
                      const blockIndex =
                        draft.blockIndex === index
                          ? null
                          : draft.blockIndex != null && draft.blockIndex > index
                            ? draft.blockIndex - 1
                            : draft.blockIndex;
                      onChange({
                        ...draft,
                        choices: draft.choices.filter((_, i) => i !== index),
                        blockIndex,
                      });
                    }}
                  >
                    <X className="size-4" />
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
          {draft.type === 'select' && draft.choices.length < MAX_OPTIONS ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="gap-1.5 text-muted-foreground"
              onClick={() => onChange({ ...draft, choices: [...draft.choices, { text: '', from: null }] })}
            >
              <Plus className="size-3.5" />
              Add a choice
            </Button>
          ) : null}
          <p className={cn('text-xs', blockingLabel ? 'text-rose-700 dark:text-rose-300' : 'text-muted-foreground')}>
            {blockingLabel
              ? `If they answer “${blockingLabel}”, the job is saved as not done.`
              : 'The engineer has to pick one of these to finish the job.'}
          </p>
        </div>
      )}

      {lostFollowUps.length > 0 ? (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300/60 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-800 dark:border-amber-500/30 dark:text-amber-200">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            Saving also removes {lostFollowUps.length === 1 ? 'this follow-up' : 'these follow-ups'}, because the
            answer {lostFollowUps.length === 1 ? 'it hangs' : 'they hang'} off is gone:{' '}
            {lostFollowUps.map((label) => `“${label}”`).join(', ')}.
          </span>
        </div>
      ) : null}

      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving || !draft.label.trim()}>
          {saving ? <Loader2 className="size-4 animate-spin" /> : null}
          {isNew ? 'Add question' : 'Save'}
        </Button>
      </div>
    </form>
  );
}

export function SettingsJobReportSection({ initialFields, onSaved }: SettingsJobReportSectionProps) {
  const [fields, setFields] = useState<JobReportField[]>(initialFields);
  const [saving, setSaving] = useState(false);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [followUpFor, setFollowUpFor] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<JobReportField | null>(null);
  const [view, setView] = useState<'questions' | 'preview'>('questions');

  useEffect(() => {
    setFields(initialFields);
  }, [initialFields]);

  const byId = useMemo(() => new Map(fields.map((field) => [field.id, field])), [fields]);
  const tree = useMemo(() => jobReportTree(fields), [fields]);

  function descendantsOf(id: string): Set<string> {
    const out = new Set<string>();
    const walk = (parent: string) => {
      for (const field of fields) {
        if (field.showWhen?.field === parent && !out.has(field.id)) {
          out.add(field.id);
          walk(field.id);
        }
      }
    };
    walk(id);
    return out;
  }

  async function persist(next: JobReportFieldInput[], done?: string): Promise<boolean> {
    setSaving(true);
    const result = await saveJobReportFields(next);
    setSaving(false);
    if (!result.success) {
      toast.error(result.error);
      return false;
    }
    setFields(result.fields);
    if (done) toast.success(done);
    onSaved();
    return true;
  }

  function closeEditor() {
    if (saving) return;
    setPlacement(null);
    setDraft(null);
  }

  function openNew(parentId: string | null, value: boolean | string | null) {
    setPlacement({ kind: 'new', parentId, value });
    setDraft(emptyDraft());
    setFollowUpFor(null);
  }

  function openEdit(field: JobReportField) {
    setPlacement({ kind: 'edit', fieldId: field.id });
    setDraft(draftFromField(field));
    setFollowUpFor(null);
  }

  const editing = placement?.kind === 'edit' ? byId.get(placement.fieldId) : undefined;
  const editorShowWhen =
    placement?.kind === 'edit'
      ? (editing?.showWhen ?? null)
      : placement?.kind === 'new' && placement.parentId != null && placement.value != null
        ? { field: placement.parentId, value: placement.value }
        : null;
  const editorParent = editorShowWhen ? byId.get(editorShowWhen.field) : undefined;

  /** Each direct follow-up of the question being edited, and the answer it will hang off after saving. */
  function remappedChildren(): { field: JobReportField; value: boolean | string | null }[] {
    if (!editing || !draft) return [];
    return fields
      .filter((field) => field.showWhen?.field === editing.id)
      .map((field) => ({
        field,
        value: followUpAnswerAfterEdit(field.showWhen!.value, editing, {
          type: draft.type,
          choices: draft.choices,
        }),
      }));
  }

  const lostIds = new Set<string>();
  for (const { field, value } of remappedChildren()) {
    if (value !== null) continue;
    lostIds.add(field.id);
    for (const id of descendantsOf(field.id)) lostIds.add(id);
  }
  const lostFollowUps = fields.filter((field) => lostIds.has(field.id)).map((field) => field.label);

  async function saveDraft() {
    if (!placement || !draft) return;
    const forcedRequired = editorParent?.blocksCompletion === true;
    const texts = draft.choices.map((choice) => choice.text.trim());
    let blockingValue: boolean | string | null = null;
    if (draft.type === 'yes_no') blockingValue = draft.blockYesNo;
    if (draft.type === 'select' && draft.blockIndex != null) {
      blockingValue = texts[draft.blockIndex] ?? '';
      if (!blockingValue) {
        toast.error('The answer ticked as “job not done” needs some wording.');
        return;
      }
    }

    const item: JobReportFieldInput = {
      id: editing?.id ?? null,
      label: draft.label,
      type: draft.type,
      options: draft.type === 'select' ? texts : [],
      multiline: draft.type === 'text' && draft.multiline,
      required: draft.type === 'text' && (draft.mustFill || forcedRequired),
      blocksCompletion: blockingValue !== null,
      blockingValue,
      showWhen: editorShowWhen,
    };

    let next: JobReportFieldInput[] = fields.map((field) => ({ ...field }));
    if (editing) {
      const moved = new Map(remappedChildren().map(({ field, value }) => [field.id, value]));
      next = next
        .filter((field) => !lostIds.has(field.id ?? ''))
        .map((field) => {
          const value = field.id ? moved.get(field.id) : undefined;
          return value == null ? field : { ...field, showWhen: { field: editing.id, value } };
        });
      next[next.findIndex((field) => field.id === editing.id)] = item;
    } else {
      const at =
        editorShowWhen != null
          ? followUpInsertIndex(fields, editorShowWhen.field, editorShowWhen.value)
          : fields.length;
      next.splice(at, 0, item);
    }

    const ok = await persist(next, editing ? 'Question saved' : `Added “${draft.label.trim()}”`);
    if (ok) {
      setPlacement(null);
      setDraft(null);
    }
  }

  async function move(
    siblings: JobReportNode[],
    index: number,
    direction: -1 | 1,
    parentId: string | null,
    value: boolean | string | null
  ) {
    const target = index + direction;
    if (target < 0 || target >= siblings.length) return;
    const reordered = [...siblings];
    const [item] = reordered.splice(index, 1);
    if (!item) return;
    reordered.splice(target, 0, item);
    const replaceBranch = (nodes: JobReportNode[]): JobReportNode[] =>
      nodes.map((node) => ({
        ...node,
        branches: node.branches.map((branch) =>
          node.field.id === parentId && branch.value === value
            ? { ...branch, fields: reordered }
            : { ...branch, fields: replaceBranch(branch.fields) }
        ),
      }));
    const next = parentId == null ? reordered : replaceBranch(tree);
    await persist(flattenJobReportTree(next));
  }

  async function confirmRemove() {
    if (!removeTarget) return;
    const target = removeTarget;
    const gone = descendantsOf(target.id);
    gone.add(target.id);
    setRemoveTarget(null);
    if (placement?.kind === 'edit' && gone.has(placement.fieldId)) closeEditor();
    await persist(
      fields.filter((field) => !gone.has(field.id)),
      `Removed “${target.label}”`
    );
  }

  const editor =
    placement && draft ? (
      <QuestionEditor
        draft={draft}
        onChange={setDraft}
        context={
          editorShowWhen && editorParent
            ? {
                parentLabel: editorParent.label,
                answer: formatShowWhenValue(editorShowWhen.value),
                notDone: blockingAnswerOf(editorParent) === editorShowWhen.value,
              }
            : null
        }
        isNew={placement.kind === 'new'}
        forcedRequired={editorParent?.blocksCompletion === true}
        lostFollowUps={lostFollowUps}
        saving={saving}
        onCancel={closeEditor}
        onSave={() => void saveDraft()}
      />
    ) : null;

  function answersOf(field: JobReportField): React.ReactNode {
    if (field.type === 'text') {
      const parent = field.showWhen ? byId.get(field.showWhen.field) : undefined;
      return <WrittenBox multiline={field.multiline} mustFill={field.required || parent?.blocksCompletion === true} />;
    }
    const blocking = blockingAnswerOf(field);
    return (
      <div className="flex flex-wrap gap-1.5">
        {answerChoices(field).map((choice) => (
          <AnswerPill key={String(choice.value)} label={choice.label} notDone={blocking === choice.value} />
        ))}
      </div>
    );
  }

  function renderQuestion(
    node: JobReportNode,
    siblings: JobReportNode[],
    index: number,
    parentId: string | null,
    branchValue: boolean | string | null,
    depth: number
  ): React.ReactNode {
    const field = node.field;
    const isEditing = placement?.kind === 'edit' && placement.fieldId === field.id;
    const choices = answerChoices(field);
    const blocking = blockingAnswerOf(field);
    const branchByValue = new Map(node.branches.map((branch) => [branch.value, branch]));
    const pending = placement?.kind === 'new' && placement.parentId === field.id ? placement.value : undefined;
    const openBranches = choices.filter((choice) => branchByValue.has(choice.value) || pending === choice.value);
    const followUps = descendantsOf(field.id).size;
    const picking = followUpFor === field.id;

    return (
      <div
        key={field.id}
        className={cn(
          'rounded-xl border transition-shadow',
          depth === 0 ? 'bg-card shadow-xs' : 'bg-muted/40',
          isEditing ? 'border-primary ring-2 ring-primary/15' : 'border-border'
        )}
      >
        <div className="p-4">
          {isEditing ? (
            editor
          ) : (
            <div className="flex items-start gap-3">
              {depth === 0 ? (
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold tabular-nums text-primary">
                  {index + 1}
                </span>
              ) : null}
              <div className="min-w-0 flex-1 space-y-2.5">
                <p className="pt-0.5 text-[15px] font-semibold leading-snug text-foreground">{field.label}</p>
                {answersOf(field)}
              </div>
              <div className="flex shrink-0 items-center gap-0.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1.5 px-2.5 text-muted-foreground"
                  disabled={saving}
                  onClick={() => openEdit(field)}
                >
                  <Pencil className="size-3.5" />
                  Edit
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8 text-muted-foreground"
                      aria-label={`More for ${field.label}`}
                      disabled={saving}
                    >
                      <MoreHorizontal className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44">
                    <DropdownMenuItem
                      disabled={index === 0}
                      onSelect={() => void move(siblings, index, -1, parentId, branchValue)}
                    >
                      <ArrowUp className="size-4" />
                      Move up
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={index === siblings.length - 1}
                      onSelect={() => void move(siblings, index, 1, parentId, branchValue)}
                    >
                      <ArrowDown className="size-4" />
                      Move down
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onSelect={() => setRemoveTarget(field)}>
                      <Trash2 className="size-4" />
                      Remove{followUps > 0 ? ` (and ${followUps} more)` : ''}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          )}

          {openBranches.length > 0 || (choices.length > 0 && !isEditing) ? (
            <div className={cn('mt-4 space-y-4', depth === 0 && 'sm:pl-10')}>
              {openBranches.map((choice) => {
                const branch = branchByValue.get(choice.value);
                const notDone = blocking === choice.value;
                return (
                  <div key={String(choice.value)}>
                    <IfTheyAnswer label={choice.label} notDone={notDone} />
                    <div
                      className={cn(
                        'space-y-2 border-l-2 pl-3',
                        notDone ? 'border-rose-300 dark:border-rose-500/40' : 'border-primary/30'
                      )}
                    >
                      {branch?.fields.map((child, childIndex) =>
                        renderQuestion(child, branch.fields, childIndex, field.id, choice.value, depth + 1)
                      )}
                      {pending === choice.value ? (
                        <div className="rounded-xl border border-primary bg-card p-4 ring-2 ring-primary/15">
                          {editor}
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}

              {choices.length > 0 && !isEditing ? (
                picking ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="mr-1 text-xs font-medium text-muted-foreground">
                      Ask a follow-up when they answer
                    </span>
                    {choices.map((choice) => (
                      <button
                        key={String(choice.value)}
                        type="button"
                        onClick={() => openNew(field.id, choice.value)}
                        className="rounded-full border border-primary/40 bg-primary/5 px-3 py-1 text-xs font-medium text-primary hover:bg-primary/10"
                      >
                        {choice.label}
                      </button>
                    ))}
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs"
                      onClick={() => setFollowUpFor(null)}
                    >
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => setFollowUpFor(field.id)}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline disabled:opacity-50"
                  >
                    <Plus className="size-3.5" aria-hidden />
                    Add a follow-up question
                  </button>
                )
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  const addingTopLevel = placement?.kind === 'new' && placement.parentId == null;
  const removeCount = removeTarget ? descendantsOf(removeTarget.id).size : 0;

  return (
    <>
      <section className="space-y-5">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Job completion</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            The form your engineers fill in to finish a job. Their answers show on the job page and in
            the outcome email.
          </p>
        </div>

        <div className="@container">
          <div className="mb-4 inline-flex rounded-lg border border-border bg-muted/50 p-0.5 @[52rem]:hidden">
            {(
              [
                { value: 'questions', label: 'Questions', icon: ListChecks },
                { value: 'preview', label: 'Preview', icon: Eye },
              ] as const
            ).map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                type="button"
                onClick={() => setView(value)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  view === value
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <Icon className="size-4" aria-hidden />
                {label}
              </button>
            ))}
          </div>

          <div className="grid gap-6 @[52rem]:grid-cols-[minmax(0,1fr)_340px] @[52rem]:items-start">
            <div className={cn('space-y-6', view === 'preview' && 'hidden @[52rem]:block')}>
              <div className="space-y-2">
                <StepLabel>Every job starts with</StepLabel>
                <div className="rounded-xl border border-dashed border-border bg-muted/20 p-4">
                  <div className="flex items-start gap-3">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                      <Lock className="size-3.5" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1 space-y-2.5">
                      <p className="pt-0.5 text-[15px] font-semibold leading-snug">Job completed?</p>
                      <div className="flex flex-wrap gap-1.5">
                        <AnswerPill label="Yes" />
                        <AnswerPill label="No" notDone />
                      </div>
                    </div>
                    <span className="pt-1 text-xs text-muted-foreground">Always asked</span>
                  </div>
                  <div className="mt-4 sm:pl-10">
                    <IfTheyAnswer label="No" notDone />
                    <div className="border-l-2 border-rose-300 pl-3 dark:border-rose-500/40">
                      <div className="space-y-2.5 rounded-xl border border-border bg-muted/40 p-4">
                        <p className="text-[15px] font-semibold leading-snug">Reason for not completing</p>
                        <WrittenBox multiline={false} mustFill />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <StepLabel>Then your questions, in this order</StepLabel>
                {tree.length === 0 && !addingTopLevel ? (
                  <div className="rounded-xl border border-border bg-card px-6 py-8 text-center">
                    <p className="text-sm font-medium">No questions of your own yet</p>
                    <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                      Add the things you need to know from every job, like whether the customer was in.
                    </p>
                  </div>
                ) : null}
                <div className="space-y-3">
                  {tree.map((node, index) => renderQuestion(node, tree, index, null, null, 0))}
                  {addingTopLevel ? (
                    <div className="rounded-xl border border-primary bg-card p-4 ring-2 ring-primary/15">
                      {editor}
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => openNew(null, null)}
                      className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-primary/40 py-3.5 text-sm font-medium text-primary transition-colors hover:bg-primary/5 disabled:opacity-50"
                    >
                      <Plus className="size-4" aria-hidden />
                      Add a question
                    </button>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <StepLabel>Every job ends with</StepLabel>
                <div className="grid gap-3 rounded-xl border border-dashed border-border bg-muted/20 p-4 sm:grid-cols-3">
                  {[
                    { label: 'Start photos', detail: 'At least one', icon: Camera },
                    { label: 'Finish photos', detail: 'At least one', icon: Camera },
                    { label: 'Job notes', detail: 'Can be left blank', icon: PenLine },
                  ].map(({ label, detail, icon: Icon }) => (
                    <div key={label} className="flex items-center gap-2.5">
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                        <Icon className="size-3.5" aria-hidden />
                      </span>
                      <div>
                        <p className="text-sm font-medium">{label}</p>
                        <p className="text-xs text-muted-foreground">{detail}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <aside
              className={cn(
                'w-full max-w-[380px] space-y-2 @[52rem]:sticky @[52rem]:top-4',
                view === 'questions' && 'hidden @[52rem]:block'
              )}
            >
              <StepLabel>What the engineer sees</StepLabel>
              <JobReportPreview fields={fields} />
            </aside>
          </div>
        </div>
      </section>

      <Dialog open={removeTarget != null} onOpenChange={(open) => !open && setRemoveTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Remove “{removeTarget?.label}”?</DialogTitle>
            <DialogDescription>
              {removeCount > 0
                ? `The ${removeCount} follow-up question${removeCount === 1 ? '' : 's'} under it will be removed too. `
                : ''}
              Jobs already finished are not changed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setRemoveTarget(null)}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" onClick={() => void confirmRemove()}>
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
