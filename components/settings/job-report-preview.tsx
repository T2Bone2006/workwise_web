'use client';

import { useState } from 'react';
import { AlertTriangle, Camera, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { blockingAnswerOf, type JobReportField } from '@/lib/jobs/job-report-fields';

type Answers = Record<string, boolean | string>;

function isShown(field: JobReportField, byId: Map<string, JobReportField>, answers: Answers): boolean {
  if (!field.showWhen) return true;
  const parent = byId.get(field.showWhen.field);
  if (!parent) return true;
  return isShown(parent, byId, answers) && answers[parent.id] === field.showWhen.value;
}

function isBlockingAnswer(field: JobReportField, answer: boolean | string | undefined): boolean {
  const blocking = blockingAnswerOf(field);
  return blocking !== null && answer === blocking;
}

function YesNo({ value, onChange }: { value: boolean | undefined; onChange: (next: boolean) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {[true, false].map((option) => (
        <button
          key={String(option)}
          type="button"
          onClick={() => onChange(option)}
          className={cn(
            'rounded-lg border py-2 text-sm font-medium transition-colors',
            value === option
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border bg-background text-foreground hover:bg-muted'
          )}
        >
          {option ? 'Yes' : 'No'}
        </button>
      ))}
    </div>
  );
}

function Question({
  label,
  optional,
  depth,
  children,
}: {
  label: string;
  optional?: boolean;
  depth: number;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn('space-y-2 animate-in fade-in slide-in-from-top-1 duration-200', depth > 0 && 'border-l-2 border-primary/30 pl-3')}
      style={depth > 1 ? { marginLeft: (depth - 1) * 12 } : undefined}
    >
      <p className="text-sm font-medium text-foreground">
        {label}
        {optional ? <span className="ml-1.5 text-xs font-normal text-muted-foreground">Optional</span> : null}
      </p>
      {children}
    </div>
  );
}

function depthOf(field: JobReportField, byId: Map<string, JobReportField>): number {
  let depth = 0;
  let current = field;
  while (current.showWhen) {
    const parent = byId.get(current.showWhen.field);
    if (!parent) break;
    depth += 1;
    current = parent;
  }
  return depth;
}

/** The finish-job form as the engineer meets it, so an owner can try their answers out. */
export function JobReportPreview({ fields }: { fields: JobReportField[] }) {
  const [answers, setAnswers] = useState<Answers>({});
  const byId = new Map(fields.map((field) => [field.id, field]));
  const set = (id: string, value: boolean | string) => setAnswers((prev) => ({ ...prev, [id]: value }));

  const shown = fields.filter((field) => isShown(field, byId, answers));
  const blockedBy = shown.find((field) => isBlockingAnswer(field, answers[field.id]));
  const notCompleted = answers.job_completed === false || blockedBy != null;
  const touched = Object.keys(answers).length > 0;

  return (
    <div className="overflow-hidden rounded-[24px] border-[5px] border-zinc-900 bg-background shadow-xl dark:border-zinc-700">
      <div className="bg-linear-to-br from-brand-primary to-sky-500 px-4 pb-5 pt-4 text-white">
        <p className="text-xs font-medium text-white/80">Back to job</p>
        <p className="mt-2 text-lg font-semibold tracking-tight">Finish the job</p>
        <p className="text-xs text-white/80">JOB-1042 · 12 High Street</p>
      </div>
      <div className="-mt-3 max-h-[400px] space-y-4 overflow-y-auto rounded-t-2xl bg-background px-4 pb-4 pt-4">
        <Question label="Job completed?" depth={0}>
          <YesNo value={answers.job_completed as boolean | undefined} onChange={(v) => set('job_completed', v)} />
        </Question>
        {answers.job_completed === false ? (
          <Question label="Reason for not completing" depth={1}>
            <div className="h-9 rounded-lg border border-border bg-muted/30" />
          </Question>
        ) : null}

        {shown.map((field) => {
          const depth = depthOf(field, byId);
          const value = answers[field.id];
          if (field.type === 'yes_no') {
            return (
              <Question key={field.id} label={field.label} depth={depth}>
                <YesNo value={value as boolean | undefined} onChange={(v) => set(field.id, v)} />
              </Question>
            );
          }
          if (field.type === 'select') {
            return (
              <Question key={field.id} label={field.label} depth={depth}>
                <select
                  aria-label={field.label}
                  className="h-9 w-full rounded-lg border border-border bg-background px-2 text-sm"
                  value={typeof value === 'string' ? value : ''}
                  onChange={(e) => set(field.id, e.target.value)}
                >
                  <option value="" disabled>
                    Choose…
                  </option>
                  {field.options.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </Question>
            );
          }
          const parent = field.showWhen ? byId.get(field.showWhen.field) : undefined;
          const mustFill = field.required || parent?.blocksCompletion === true;
          return (
            <Question key={field.id} label={field.label} optional={!mustFill} depth={depth}>
              <div className={cn('rounded-lg border border-border bg-muted/30', field.multiline ? 'h-16' : 'h-9')} />
            </Question>
          );
        })}

        <div className="grid grid-cols-2 gap-2 pt-1">
          {['Start photos', 'Finish photos'].map((label) => (
            <div
              key={label}
              className="flex flex-col items-center gap-1 rounded-lg border border-dashed border-border py-3 text-xs text-muted-foreground"
            >
              <Camera className="size-4" aria-hidden />
              {label}
            </div>
          ))}
        </div>
        <Question label="Job notes" optional depth={0}>
          <div className="h-12 rounded-lg border border-border bg-muted/30" />
        </Question>

        {notCompleted ? (
          <div className="flex items-start gap-2 rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>
              Saved as <span className="font-semibold">not completed</span>
              {blockedBy && answers.job_completed !== false ? ` because of “${blockedBy.label}”` : ''}.
            </span>
          </div>
        ) : null}
        <div className="rounded-xl bg-primary py-2.5 text-center text-sm font-semibold text-primary-foreground opacity-90">
          Complete job
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-border bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
        <span>Tap the answers to see what follows.</span>
        {touched ? (
          <button
            type="button"
            className="inline-flex items-center gap-1 font-medium text-foreground hover:underline"
            onClick={() => setAnswers({})}
          >
            <RotateCcw className="size-3" aria-hidden />
            Reset
          </button>
        ) : null}
      </div>
    </div>
  );
}
